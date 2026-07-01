import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  bigint,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const detectorTypeEnum = pgEnum("detector_type", [
  "refund_leak",
  "shipping_leak",
]);

export const findingSeverityEnum = pgEnum("finding_severity", [
  "critical",
  "warning",
  "info",
]);

export const findingStatusEnum = pgEnum("finding_status", [
  "new",
  "investigating",
  "resolved",
  "ignored",
]);

export const planNameEnum = pgEnum("plan_name", ["starter", "growth", "pro"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

export const syncStatusEnum = pgEnum("sync_status", [
  "pending",
  "running",
  "completed",
  "failed",
]);

export const syncResourceEnum = pgEnum("sync_resource", [
  "orders",
  "products",
  "customers",
  "refunds",
]);

// ---------------------------------------------------------------------------
// Tenants
// ---------------------------------------------------------------------------

export const shops = pgTable("shops", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 255 }).notNull(),
  myshopifyDomain: varchar("myshopify_domain", { length: 255 })
    .notNull()
    .unique(),
  // Shopify OAuth fields — stored encrypted at rest in production environments
  accessToken: text("access_token"),
  installedScopes: varchar("installed_scopes", { length: 1024 }),
  isActive: boolean("is_active").notNull().default(true),
  currency: varchar("currency", { length: 8 }).notNull().default("USD"),
  monthlyOrderVolume: integer("monthly_order_volume").notNull().default(0),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull(),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  uninstalledAt: timestamp("uninstalled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Findings (output of the Detection Engine)
// ---------------------------------------------------------------------------

export const findings = pgTable("findings", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" }),
  detectorType: detectorTypeEnum("detector_type").notNull(),
  severity: findingSeverityEnum("severity").notNull(),
  status: findingStatusEnum("status").notNull().default("new"),
  title: varchar("title", { length: 255 }).notNull(),
  summary: text("summary").notNull(),
  explanation: text("explanation").notNull(),
  rootCauses: jsonb("root_causes").$type<string[]>().notNull().default([]),
  recommendation: text("recommendation").notNull(),
  recommendationSteps: jsonb("recommendation_steps")
    .$type<string[]>()
    .notNull()
    .default([]),
  monthlyImpact: numeric("monthly_impact", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  impactToDate: numeric("impact_to_date", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  recoveredAmount: numeric("recovered_amount", { precision: 12, scale: 2 })
    .notNull()
    .default("0"),
  confidence: integer("confidence").notNull().default(80),
  affectedOrdersCount: integer("affected_orders_count").notNull().default(0),
  firstDetectedAt: timestamp("first_detected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastDetectedAt: timestamp("last_detected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Finding evidence (sample order-level proof shown in Finding Details)
// ---------------------------------------------------------------------------

export const findingEvidence = pgTable("finding_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  findingId: uuid("finding_id")
    .notNull()
    .references(() => findings.id, { onDelete: "cascade" }),
  orderNumber: varchar("order_number", { length: 32 }).notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  note: text("note").notNull(),
});

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------

export const billingSubscriptions = pgTable("billing_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" })
    .unique(),
  planName: planNameEnum("plan_name").notNull().default("starter"),
  status: subscriptionStatusEnum("status").notNull().default("trialing"),
  priceMonthly: numeric("price_monthly", { precision: 10, scale: 2 })
    .notNull()
    .default("0"),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  recoveredAmountToDate: numeric("recovered_amount_to_date", {
    precision: 12,
    scale: 2,
  })
    .notNull()
    .default("0"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const shopSettings = pgTable("shop_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  shopId: uuid("shop_id")
    .notNull()
    .references(() => shops.id, { onDelete: "cascade" })
    .unique(),
  notificationEmail: varchar("notification_email", { length: 255 }).notNull(),
  weeklyDigestEnabled: boolean("weekly_digest_enabled")
    .notNull()
    .default(true),
  instantAlertsEnabled: boolean("instant_alerts_enabled")
    .notNull()
    .default(true),
  alertThreshold: numeric("alert_threshold", { precision: 10, scale: 2 })
    .notNull()
    .default("50"),
  refundLeakEnabled: boolean("refund_leak_enabled").notNull().default(true),
  shippingLeakEnabled: boolean("shipping_leak_enabled")
    .notNull()
    .default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// OAuth nonce store (anti-CSRF state parameter)
// ---------------------------------------------------------------------------

export const oauthNonces = pgTable("oauth_nonces", {
  id: uuid("id").primaryKey().defaultRandom(),
  nonce: varchar("nonce", { length: 64 }).notNull().unique(),
  shop: varchar("shop", { length: 255 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ===========================================================================
// SHOPIFY DATA SYNC TABLES
// ===========================================================================
// These tables mirror Shopify data downloaded via the GraphQL Admin API.
// They are keyed by shopify_id (the Shopify GID numeric portion) + shop_id
// to support multi-tenant isolation. All upserts use shopify_id as the
// idempotency key — re-running the sync is always safe.
// ===========================================================================

// ---------------------------------------------------------------------------
// Sync log — tracks each sync job per shop per resource
// ---------------------------------------------------------------------------

export const syncLogs = pgTable(
  "sync_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    resource: syncResourceEnum("resource").notNull(),
    status: syncStatusEnum("status").notNull().default("pending"),
    syncType: varchar("sync_type", { length: 16 }).notNull().default("full"), // 'full' | 'incremental'
    recordsSynced: integer("records_synced").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    // The updatedAt cursor used for incremental sync
    cursorUpdatedAt: timestamp("cursor_updated_at", { withTimezone: true }),
  },
  (t) => [index("sync_logs_shop_resource_idx").on(t.shopId, t.resource)],
);

// ---------------------------------------------------------------------------
// Shopify Customers
// ---------------------------------------------------------------------------

export const shopifyCustomers = pgTable(
  "shopify_customers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    // Shopify's GID e.g. "gid://shopify/Customer/12345" — stored as the
    // numeric ID for efficient lookups and JOINs with orders.
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    email: varchar("email", { length: 255 }),
    firstName: varchar("first_name", { length: 255 }),
    lastName: varchar("last_name", { length: 255 }),
    phone: varchar("phone", { length: 64 }),
    state: varchar("state", { length: 64 }), // enabled, disabled, declined, invited
    // Total spend and order count as reported by Shopify at sync time
    totalSpent: numeric("total_spent", { precision: 14, scale: 2 }),
    ordersCount: integer("orders_count").notNull().default(0),
    // Whether the customer has verified their email
    verifiedEmail: boolean("verified_email").notNull().default(false),
    taxExempt: boolean("tax_exempt").notNull().default(false),
    tags: text("tags"), // comma-separated
    note: text("note"),
    // Raw address data stored as JSON for flexibility
    defaultAddress: jsonb("default_address").$type<Record<string, string>>(),
    shopifyCreatedAt: timestamp("shopify_created_at", { withTimezone: true }),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("shopify_customers_shop_shopify_id_idx").on(
      t.shopId,
      t.shopifyId,
    ),
    index("shopify_customers_shop_email_idx").on(t.shopId, t.email),
  ],
);

// ---------------------------------------------------------------------------
// Shopify Products
// ---------------------------------------------------------------------------

export const shopifyProducts = pgTable(
  "shopify_products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    handle: varchar("handle", { length: 512 }),
    productType: varchar("product_type", { length: 255 }),
    vendor: varchar("vendor", { length: 255 }),
    status: varchar("status", { length: 64 }), // active, archived, draft
    tags: text("tags"), // comma-separated
    descriptionHtml: text("description_html"),
    // Track total inventory and variant count for analytics
    totalInventory: integer("total_inventory"),
    variantCount: integer("variant_count").notNull().default(0),
    shopifyCreatedAt: timestamp("shopify_created_at", { withTimezone: true }),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("shopify_products_shop_shopify_id_idx").on(
      t.shopId,
      t.shopifyId,
    ),
    index("shopify_products_shop_handle_idx").on(t.shopId, t.handle),
  ],
);

// ---------------------------------------------------------------------------
// Shopify Product Variants
// ---------------------------------------------------------------------------

export const shopifyProductVariants = pgTable(
  "shopify_product_variants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => shopifyProducts.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    shopifyProductId: varchar("shopify_product_id", { length: 64 }).notNull(),
    title: varchar("title", { length: 512 }).notNull(),
    sku: varchar("sku", { length: 255 }),
    barcode: varchar("barcode", { length: 255 }),
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    compareAtPrice: numeric("compare_at_price", { precision: 12, scale: 2 }),
    inventoryQuantity: integer("inventory_quantity").notNull().default(0),
    inventoryPolicy: varchar("inventory_policy", { length: 64 }), // deny, continue
    inventoryManagement: varchar("inventory_management", { length: 64 }), // shopify, null
    weight: numeric("weight", { precision: 10, scale: 3 }),
    weightUnit: varchar("weight_unit", { length: 8 }), // kg, lb, oz, g
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    taxable: boolean("taxable").notNull().default(true),
    // Variant options (e.g. Color: Red, Size: L)
    option1: varchar("option1", { length: 255 }),
    option2: varchar("option2", { length: 255 }),
    option3: varchar("option3", { length: 255 }),
    position: integer("position").notNull().default(1),
    shopifyCreatedAt: timestamp("shopify_created_at", { withTimezone: true }),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("shopify_variants_shop_shopify_id_idx").on(
      t.shopId,
      t.shopifyId,
    ),
    index("shopify_variants_product_idx").on(t.productId),
    index("shopify_variants_sku_idx").on(t.shopId, t.sku),
  ],
);

// ---------------------------------------------------------------------------
// Shopify Orders
// ---------------------------------------------------------------------------

export const shopifyOrders = pgTable(
  "shopify_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    // Optional FK to local customer record — may be null for guest orders
    customerId: uuid("customer_id").references(() => shopifyCustomers.id, {
      onDelete: "set null",
    }),
    shopifyCustomerId: varchar("shopify_customer_id", { length: 64 }),
    // Human-readable order name e.g. "#1001"
    name: varchar("name", { length: 64 }).notNull(),
    orderNumber: integer("order_number").notNull(),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 64 }),
    // Financial status: pending, authorized, partially_paid, paid,
    //   partially_refunded, refunded, voided
    financialStatus: varchar("financial_status", { length: 64 }),
    // Fulfillment status: null, fulfilled, partial, restocked, unfulfilled
    fulfillmentStatus: varchar("fulfillment_status", { length: 64 }),
    // Totals — stored as numeric for precision arithmetic in the detection engine
    totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
    subtotalPrice: numeric("subtotal_price", { precision: 12, scale: 2 }),
    totalTax: numeric("total_tax", { precision: 12, scale: 2 }),
    totalDiscounts: numeric("total_discounts", { precision: 12, scale: 2 }),
    totalShippingPrice: numeric("total_shipping_price", {
      precision: 12,
      scale: 2,
    }),
    totalRefunded: numeric("total_refunded", { precision: 12, scale: 2 }),
    currency: varchar("currency", { length: 8 }).notNull(),
    // Shipping address stored as JSON (country, province, city, zip)
    shippingAddress: jsonb("shipping_address").$type<Record<string, string>>(),
    // Billing address
    billingAddress: jsonb("billing_address").$type<Record<string, string>>(),
    // Tags, note, source
    tags: text("tags"),
    note: text("note"),
    sourceIdentifier: varchar("source_identifier", { length: 255 }),
    // Whether the order has been cancelled
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelReason: varchar("cancel_reason", { length: 64 }),
    // Whether the order is a test order
    test: boolean("test").notNull().default(false),
    shopifyCreatedAt: timestamp("shopify_created_at", {
      withTimezone: true,
    }).notNull(),
    shopifyUpdatedAt: timestamp("shopify_updated_at", { withTimezone: true }),
    shopifyProcessedAt: timestamp("shopify_processed_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("shopify_orders_shop_shopify_id_idx").on(t.shopId, t.shopifyId),
    index("shopify_orders_shop_created_idx").on(
      t.shopId,
      t.shopifyCreatedAt,
    ),
    index("shopify_orders_shop_financial_status_idx").on(
      t.shopId,
      t.financialStatus,
    ),
    index("shopify_orders_customer_idx").on(t.customerId),
  ],
);

// ---------------------------------------------------------------------------
// Shopify Order Line Items
// ---------------------------------------------------------------------------

export const shopifyOrderLineItems = pgTable(
  "shopify_order_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => shopifyOrders.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    shopifyOrderId: varchar("shopify_order_id", { length: 64 }).notNull(),
    // Optional FK to local variant record
    variantId: uuid("variant_id").references(
      () => shopifyProductVariants.id,
      { onDelete: "set null" },
    ),
    shopifyVariantId: varchar("shopify_variant_id", { length: 64 }),
    shopifyProductId: varchar("shopify_product_id", { length: 64 }),
    title: varchar("title", { length: 512 }).notNull(),
    variantTitle: varchar("variant_title", { length: 512 }),
    sku: varchar("sku", { length: 255 }),
    vendor: varchar("vendor", { length: 255 }),
    quantity: integer("quantity").notNull(),
    // Prices — per-unit
    price: numeric("price", { precision: 12, scale: 2 }).notNull(),
    totalDiscount: numeric("total_discount", { precision: 12, scale: 2 }),
    taxable: boolean("taxable").notNull().default(true),
    requiresShipping: boolean("requires_shipping").notNull().default(true),
    fulfillmentStatus: varchar("fulfillment_status", { length: 64 }),
    fulfillmentService: varchar("fulfillment_service", { length: 128 }),
    giftCard: boolean("gift_card").notNull().default(false),
    // Whether this line item was refunded (for quick detection engine queries)
    refundedQuantity: integer("refunded_quantity").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("shopify_line_items_shop_shopify_id_idx").on(
      t.shopId,
      t.shopifyId,
    ),
    index("shopify_line_items_order_idx").on(t.orderId),
    index("shopify_line_items_variant_idx").on(t.variantId),
    index("shopify_line_items_sku_idx").on(t.shopId, t.sku),
  ],
);

// ---------------------------------------------------------------------------
// Shopify Refunds
// ---------------------------------------------------------------------------

export const shopifyRefunds = pgTable(
  "shopify_refunds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    orderId: uuid("order_id")
      .notNull()
      .references(() => shopifyOrders.id, { onDelete: "cascade" }),
    shopifyId: varchar("shopify_id", { length: 64 }).notNull(),
    shopifyOrderId: varchar("shopify_order_id", { length: 64 }).notNull(),
    // Staff note for the refund
    note: text("note"),
    // Whether the refund was created via the API or the Shopify admin
    restock: boolean("restock").notNull().default(false),
    // Total amount refunded in this refund event
    totalRefunded: numeric("total_refunded", { precision: 12, scale: 2 }),
    // Line items that were refunded in this refund event (JSON for flexibility)
    refundLineItems: jsonb("refund_line_items")
      .$type<
        Array<{
          lineItemId: string;
          quantity: number;
          restockType: string;
          subtotal: string;
          totalTax: string;
        }>
      >()
      .notNull()
      .default([]),
    // Transactions associated with this refund
    transactions: jsonb("transactions")
      .$type<
        Array<{
          id: string;
          amount: string;
          currency: string;
          gateway: string;
          kind: string;
          status: string;
        }>
      >()
      .notNull()
      .default([]),
    shopifyCreatedAt: timestamp("shopify_created_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("shopify_refunds_shop_shopify_id_idx").on(
      t.shopId,
      t.shopifyId,
    ),
    index("shopify_refunds_order_idx").on(t.orderId),
    index("shopify_refunds_shop_created_idx").on(
      t.shopId,
      t.shopifyCreatedAt,
    ),
  ],
);

// ---------------------------------------------------------------------------
// Type exports (inferred from table definitions)
// ---------------------------------------------------------------------------

export type Shop = typeof shops.$inferSelect;
export type ShopInsert = typeof shops.$inferInsert;

export type ShopifyCustomer = typeof shopifyCustomers.$inferSelect;
export type ShopifyCustomerInsert = typeof shopifyCustomers.$inferInsert;

export type ShopifyProduct = typeof shopifyProducts.$inferSelect;
export type ShopifyProductInsert = typeof shopifyProducts.$inferInsert;

export type ShopifyProductVariant = typeof shopifyProductVariants.$inferSelect;
export type ShopifyProductVariantInsert =
  typeof shopifyProductVariants.$inferInsert;

export type ShopifyOrder = typeof shopifyOrders.$inferSelect;
export type ShopifyOrderInsert = typeof shopifyOrders.$inferInsert;

export type ShopifyOrderLineItem = typeof shopifyOrderLineItems.$inferSelect;
export type ShopifyOrderLineItemInsert =
  typeof shopifyOrderLineItems.$inferInsert;

export type ShopifyRefund = typeof shopifyRefunds.$inferSelect;
export type ShopifyRefundInsert = typeof shopifyRefunds.$inferInsert;

export type SyncLog = typeof syncLogs.$inferSelect;
export type SyncLogInsert = typeof syncLogs.$inferInsert;
