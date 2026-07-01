/**
 * Shopify Products Sync Service
 *
 * Downloads all products and their variants from the Shopify Admin GraphQL API
 * and upserts them into the shopify_products and shopify_product_variants tables.
 *
 * Supports:
 * - Full sync (all products and variants)
 * - Incremental sync (products updated since the last sync)
 * - Multi-tenant: scoped by shopId
 * - Idempotent: re-running is always safe (upsert on shopify_id)
 * - Pagination: follows cursor for products; fetches up to 100 variants per product
 */

import { db } from "@/db";
import { shopifyProducts, shopifyProductVariants } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createGraphQLClient } from "@/lib/shopify/graphql-client";
import {
  PRODUCTS_QUERY,
  extractShopifyId,
  buildUpdatedAtQuery,
  type ProductsQueryResult,
  type ShopifyProductNode,
  type ShopifyVariantNode,
} from "./queries";
import {
  startSyncLog,
  completeSyncLog,
  failSyncLog,
  incrementSyncLogCount,
  getLastSuccessfulSync,
} from "./sync-log-repository";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50; // Products per page

// ---------------------------------------------------------------------------
// Variant upsert
// ---------------------------------------------------------------------------

async function upsertVariant(
  shopId: string,
  productDbId: string,
  shopifyProductId: string,
  node: ShopifyVariantNode,
): Promise<void> {
  const shopifyId = extractShopifyId(node.id);

  // Extract option values from selectedOptions array
  const options = node.selectedOptions ?? [];
  const option1 = options[0]?.value ?? null;
  const option2 = options[1]?.value ?? null;
  const option3 = options[2]?.value ?? null;

  const values = {
    shopId,
    productId: productDbId,
    shopifyId,
    shopifyProductId,
    title: node.title,
    sku: node.sku ?? null,
    barcode: node.barcode ?? null,
    price: node.price,
    compareAtPrice: node.compareAtPrice ?? null,
    inventoryQuantity: node.inventoryQuantity ?? 0,
    inventoryPolicy: node.inventoryPolicy ?? null,
    inventoryManagement: node.inventoryManagement ?? null,
    weight: node.weight !== null && node.weight !== undefined
      ? String(node.weight)
      : null,
    weightUnit: node.weightUnit ?? null,
    requiresShipping: node.requiresShipping,
    taxable: node.taxable,
    option1,
    option2,
    option3,
    position: node.position ?? 1,
    shopifyCreatedAt: node.createdAt ? new Date(node.createdAt) : null,
    shopifyUpdatedAt: node.updatedAt ? new Date(node.updatedAt) : null,
    updatedAt: new Date(),
  };

  const [existing] = await db
    .select({ id: shopifyProductVariants.id })
    .from(shopifyProductVariants)
    .where(
      and(
        eq(shopifyProductVariants.shopId, shopId),
        eq(shopifyProductVariants.shopifyId, shopifyId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(shopifyProductVariants)
      .set(values)
      .where(eq(shopifyProductVariants.id, existing.id));
  } else {
    await db.insert(shopifyProductVariants).values(values);
  }
}

// ---------------------------------------------------------------------------
// Product upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a product and all its variants.
 * Returns the internal DB id of the product.
 */
async function upsertProduct(
  shopId: string,
  node: ShopifyProductNode,
): Promise<string> {
  const shopifyId = extractShopifyId(node.id);

  const variantEdges = node.variants.edges;
  const variantCount = variantEdges.length;

  const productValues = {
    shopId,
    shopifyId,
    title: node.title,
    handle: node.handle ?? null,
    productType: node.productType ?? null,
    vendor: node.vendor ?? null,
    status: node.status ?? null,
    tags: node.tags.join(",") || null,
    descriptionHtml: node.descriptionHtml ?? null,
    totalInventory: node.totalInventory ?? null,
    variantCount,
    shopifyCreatedAt: node.createdAt ? new Date(node.createdAt) : null,
    shopifyUpdatedAt: node.updatedAt ? new Date(node.updatedAt) : null,
    updatedAt: new Date(),
  };

  let productDbId: string;

  const [existing] = await db
    .select({ id: shopifyProducts.id })
    .from(shopifyProducts)
    .where(
      and(
        eq(shopifyProducts.shopId, shopId),
        eq(shopifyProducts.shopifyId, shopifyId),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(shopifyProducts)
      .set(productValues)
      .where(eq(shopifyProducts.id, existing.id));
    productDbId = existing.id;
  } else {
    const [created] = await db
      .insert(shopifyProducts)
      .values(productValues)
      .returning({ id: shopifyProducts.id });
    productDbId = created!.id;
  }

  // Upsert all variants for this product
  for (const { node: variantNode } of variantEdges) {
    await upsertVariant(shopId, productDbId, shopifyId, variantNode);
  }

  return productDbId;
}

// ---------------------------------------------------------------------------
// Core sync function
// ---------------------------------------------------------------------------

/**
 * Sync products (and variants) for a single shop.
 *
 * @param shopId  Internal UUID of the shop
 * @param shop    myshopify.com domain
 * @param accessToken  Shopify Admin API access token
 * @param syncType  "full" | "incremental"
 */
export async function syncProducts(
  shopId: string,
  shop: string,
  accessToken: string,
  syncType: "full" | "incremental" = "full",
): Promise<{ synced: number }> {
  const logId = await startSyncLog(shopId, "products", syncType);
  const client = createGraphQLClient(shop, accessToken);

  let totalSynced = 0;
  let cursor: string | null = null;
  let hasNextPage = true;
  let lastUpdatedAt: Date | null = null;

  let queryFilter: string | undefined;
  if (syncType === "incremental") {
    const lastSync = await getLastSuccessfulSync(shopId, "products");
    if (lastSync?.cursorUpdatedAt) {
      queryFilter = buildUpdatedAtQuery(lastSync.cursorUpdatedAt);
      console.log(
        `[products-sync][${shop}] Incremental sync since ${lastSync.cursorUpdatedAt.toISOString()}`,
      );
    } else {
      console.log(
        `[products-sync][${shop}] No previous successful sync found, falling back to full sync`,
      );
    }
  }

  console.log(`[products-sync][${shop}] Starting ${syncType} sync`);

  try {
    while (hasNextPage) {
      const variables: Record<string, unknown> = {
        first: PAGE_SIZE,
        after: cursor ?? null,
        query: queryFilter ?? null,
      };

      const result = await client.query<ProductsQueryResult>(
        PRODUCTS_QUERY,
        variables,
      );

      const { edges, pageInfo } = result.products;

      for (const { node } of edges) {
        await upsertProduct(shopId, node);
        totalSynced++;

        if (node.updatedAt) {
          const nodeUpdatedAt = new Date(node.updatedAt);
          if (!lastUpdatedAt || nodeUpdatedAt > lastUpdatedAt) {
            lastUpdatedAt = nodeUpdatedAt;
          }
        }
      }

      await incrementSyncLogCount(logId, edges.length);

      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor ?? null;

      console.log(
        `[products-sync][${shop}] Page synced: ${edges.length} products (total: ${totalSynced}, hasNextPage: ${hasNextPage})`,
      );
    }

    await completeSyncLog(logId, totalSynced, lastUpdatedAt ?? undefined);
    console.log(
      `[products-sync][${shop}] Completed: ${totalSynced} products synced`,
    );

    return { synced: totalSynced };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[products-sync][${shop}] Failed:`, message);
    await failSyncLog(logId, message, totalSynced);
    throw error;
  }
}
