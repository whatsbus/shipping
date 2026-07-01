/**
 * Shopify GraphQL Admin API Queries
 *
 * All GraphQL queries used by the sync services are defined here.
 * Centralizing queries makes it easy to:
 * - Review the data fields being fetched
 * - Manage query cost (Shopify calculates cost per field)
 * - Update API version fields in one place
 *
 * Design decisions:
 * - We use cursor-based pagination (edges/pageInfo pattern)
 * - We fetch 50 records per page (balances cost vs. number of requests)
 * - We filter by updated_at for incremental sync
 * - We include refunds inside orders to minimize API round-trips
 */

// ---------------------------------------------------------------------------
// Pagination types
// ---------------------------------------------------------------------------

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Edge<T> {
  cursor: string;
  node: T;
}

export interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
}

// ---------------------------------------------------------------------------
// Order types
// ---------------------------------------------------------------------------

export interface ShopifyAddress {
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  provinceCode: string | null;
  country: string | null;
  countryCodeV2: string | null;
  zip: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  name: string | null;
}

export interface ShopifyMoneyV2 {
  amount: string;
  currencyCode: string;
}

export interface ShopifyLineItemNode {
  id: string;
  title: string;
  variantTitle: string | null;
  sku: string | null;
  vendor: string | null;
  quantity: number;
  originalUnitPrice: ShopifyMoneyV2;
  discountedUnitPrice: ShopifyMoneyV2;
  totalDiscount: ShopifyMoneyV2;
  taxable: boolean;
  requiresShipping: boolean;
  fulfillmentStatus: string | null;
  fulfillmentService: { handle: string } | null;
  giftCard: boolean;
  variant: {
    id: string;
    title: string;
    sku: string | null;
    price: string;
  } | null;
  product: {
    id: string;
    title: string;
  } | null;
}

export interface ShopifyRefundLineItem {
  lineItem: { id: string };
  quantity: number;
  restockType: string;
  subtotal: ShopifyMoneyV2;
  totalTax: ShopifyMoneyV2;
}

export interface ShopifyTransaction {
  id: string;
  amount: string;
  formattedGateway: string | null;
  kind: string;
  status: string;
  gateway: string | null;
  currency: string;
}

export interface ShopifyRefundNode {
  id: string;
  note: string | null;
  createdAt: string;
  refundLineItems: {
    edges: Edge<ShopifyRefundLineItem>[];
  };
  transactions: {
    edges: Edge<ShopifyTransaction>[];
  };
  totalRefunded: ShopifyMoneyV2;
  duties: Array<unknown>;
}

export interface ShopifyOrderNode {
  id: string;
  name: string;
  orderNumber: number;
  email: string | null;
  phone: string | null;
  financialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: { shopMoney: ShopifyMoneyV2 };
  subtotalPriceSet: { shopMoney: ShopifyMoneyV2 } | null;
  totalTaxSet: { shopMoney: ShopifyMoneyV2 } | null;
  totalDiscountsSet: { shopMoney: ShopifyMoneyV2 } | null;
  totalShippingPriceSet: { shopMoney: ShopifyMoneyV2 } | null;
  totalRefundedSet: { shopMoney: ShopifyMoneyV2 } | null;
  currencyCode: string;
  shippingAddress: ShopifyAddress | null;
  billingAddress: ShopifyAddress | null;
  tags: string[];
  note: string | null;
  sourceIdentifier: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  test: boolean;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  customer: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  lineItems: Connection<ShopifyLineItemNode>;
  refunds: ShopifyRefundNode[];
}

export interface OrdersQueryResult {
  orders: Connection<ShopifyOrderNode>;
}

// ---------------------------------------------------------------------------
// Product types
// ---------------------------------------------------------------------------

export interface ShopifyVariantNode {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryPolicy: string;
  inventoryManagement: string | null;
  weight: number | null;
  weightUnit: string | null;
  requiresShipping: boolean;
  taxable: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface ShopifyProductNode {
  id: string;
  title: string;
  handle: string;
  productType: string;
  vendor: string;
  status: string;
  tags: string[];
  descriptionHtml: string | null;
  totalInventory: number | null;
  createdAt: string;
  updatedAt: string;
  variants: Connection<ShopifyVariantNode>;
}

export interface ProductsQueryResult {
  products: Connection<ShopifyProductNode>;
}

// ---------------------------------------------------------------------------
// Customer types
// ---------------------------------------------------------------------------

export interface ShopifyCustomerNode {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  state: string;
  numberOfOrders: number;
  amountSpent: ShopifyMoneyV2;
  verifiedEmail: boolean;
  taxExempt: boolean;
  tags: string[];
  note: string | null;
  defaultAddress: ShopifyAddress | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomersQueryResult {
  customers: Connection<ShopifyCustomerNode>;
}

// ---------------------------------------------------------------------------
// GraphQL query strings
// ---------------------------------------------------------------------------

/**
 * Fetch orders with line items and embedded refunds.
 * Variables:
 *   $first: Int! — page size (max 50 for orders with line items)
 *   $after: String — cursor for pagination
 *   $query: String — Shopify search query (e.g. "updated_at:>'2024-01-01'")
 */
export const ORDERS_QUERY = `
  query SyncOrders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          name
          orderNumber
          email
          phone
          financialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          subtotalPriceSet { shopMoney { amount currencyCode } }
          totalTaxSet { shopMoney { amount currencyCode } }
          totalDiscountsSet { shopMoney { amount currencyCode } }
          totalShippingPriceSet { shopMoney { amount currencyCode } }
          totalRefundedSet { shopMoney { amount currencyCode } }
          currencyCode
          tags
          note
          sourceIdentifier
          cancelledAt
          cancelReason
          test
          createdAt
          updatedAt
          processedAt
          shippingAddress {
            address1
            address2
            city
            province
            provinceCode
            country
            countryCodeV2
            zip
            phone
            firstName
            lastName
            company
            name
          }
          billingAddress {
            address1
            address2
            city
            province
            provinceCode
            country
            countryCodeV2
            zip
            phone
            firstName
            lastName
            company
            name
          }
          customer {
            id
            email
            firstName
            lastName
          }
          lineItems(first: 50) {
            edges {
              node {
                id
                title
                variantTitle
                sku
                vendor
                quantity
                originalUnitPrice { amount currencyCode }
                discountedUnitPrice { amount currencyCode }
                totalDiscount { amount currencyCode }
                taxable
                requiresShipping
                fulfillmentStatus
                fulfillmentService { handle }
                giftCard
                variant {
                  id
                  title
                  sku
                  price
                }
                product {
                  id
                  title
                }
              }
            }
          }
          refunds {
            id
            note
            createdAt
            totalRefunded { amount currencyCode }
            refundLineItems(first: 20) {
              edges {
                node {
                  lineItem { id }
                  quantity
                  restockType
                  subtotal { amount currencyCode }
                  totalTax { amount currencyCode }
                }
              }
            }
            transactions(first: 10) {
              edges {
                node {
                  id
                  amount
                  gateway
                  kind
                  status
                  currency: currencyCode
                }
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch products with all variants.
 * Variables:
 *   $first: Int! — page size
 *   $after: String — pagination cursor
 *   $query: String — filter query
 */
export const PRODUCTS_QUERY = `
  query SyncProducts($first: Int!, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          title
          handle
          productType
          vendor
          status
          tags
          descriptionHtml
          totalInventory
          createdAt
          updatedAt
          variants(first: 100) {
            edges {
              node {
                id
                title
                sku
                barcode
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                inventoryManagement
                weight
                weightUnit
                requiresShipping
                taxable
                selectedOptions { name value }
                position
                createdAt
                updatedAt
              }
            }
          }
        }
      }
    }
  }
`;

/**
 * Fetch customers.
 * Variables:
 *   $first: Int! — page size
 *   $after: String — pagination cursor
 *   $query: String — filter query
 */
export const CUSTOMERS_QUERY = `
  query SyncCustomers($first: Int!, $after: String, $query: String) {
    customers(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        cursor
        node {
          id
          email
          firstName
          lastName
          phone
          state
          numberOfOrders
          amountSpent { amount currencyCode }
          verifiedEmail
          taxExempt
          tags
          note
          createdAt
          updatedAt
          defaultAddress {
            address1
            address2
            city
            province
            provinceCode
            country
            countryCodeV2
            zip
            phone
            firstName
            lastName
            company
            name
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// Helper to extract numeric ID from Shopify GID
// e.g. "gid://shopify/Order/12345" -> "12345"
// ---------------------------------------------------------------------------

export function extractShopifyId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? gid;
}

// ---------------------------------------------------------------------------
// Helper to build updatedAt filter for incremental sync
// ---------------------------------------------------------------------------

export function buildUpdatedAtQuery(since: Date): string {
  // Shopify query format: updated_at:>'2024-01-15T00:00:00Z'
  const iso = since.toISOString();
  return `updated_at:>'${iso}'`;
}
