/**
 * Shopify GraphQL Admin API Client
 *
 * A low-level client that handles:
 * - Authentication (X-Shopify-Access-Token header)
 * - Rate limiting: detects THROTTLED errors and waits the exact amount
 *   of time needed for the bucket to refill (using Shopify's own numbers).
 * - Transient failure retries with exponential backoff (network errors,
 *   5xx responses, etc.)
 * - Structured error extraction and typed responses
 *
 * Design: pure functions + a thin class to hold shop/token context.
 * All sync services import this client — never call fetch() directly.
 */

import { SHOPIFY_API_VERSION } from "./config";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_RETRIES = 5;
const INITIAL_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 30_000;

// ---------------------------------------------------------------------------
// Shopify GraphQL response types
// ---------------------------------------------------------------------------

export interface GraphQLThrottleStatus {
  maximumAvailable: number;
  currentlyAvailable: number;
  restoreRate: number;
}

export interface GraphQLCostExtension {
  requestedQueryCost: number;
  actualQueryCost: number;
  throttleStatus: GraphQLThrottleStatus;
}

export interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: string[];
  extensions?: {
    code?: string;
    cost?: GraphQLCostExtension;
    [key: string]: unknown;
  };
}

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: GraphQLError[];
  extensions?: {
    cost?: GraphQLCostExtension;
  };
}

// ---------------------------------------------------------------------------
// Error classes
// ---------------------------------------------------------------------------

export class ShopifyGraphQLError extends Error {
  constructor(
    message: string,
    public readonly errors: GraphQLError[],
    public readonly shop: string,
  ) {
    super(message);
    this.name = "ShopifyGraphQLError";
  }
}

export class ShopifyGraphQLThrottleError extends ShopifyGraphQLError {
  constructor(
    shop: string,
    errors: GraphQLError[],
    public readonly waitMs: number,
  ) {
    super(`GraphQL throttled for shop ${shop}, waiting ${waitMs}ms`, errors, shop);
    this.name = "ShopifyGraphQLThrottleError";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the wait time in milliseconds for a THROTTLED response.
 * Uses Shopify's throttle status to calculate exactly how long to wait
 * for the bucket to have enough capacity.
 */
function computeThrottleWaitMs(cost: GraphQLCostExtension): number {
  const { requestedQueryCost, throttleStatus } = cost;
  const { currentlyAvailable, restoreRate } = throttleStatus;
  const deficit = requestedQueryCost - currentlyAvailable;

  if (deficit <= 0) {
    // We somehow still have capacity — minimal wait
    return 500;
  }

  // Time to restore = deficit / restore_rate (seconds), then add 100ms buffer
  const waitSeconds = deficit / restoreRate;
  return Math.ceil(waitSeconds * 1000) + 100;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientError(error: unknown): boolean {
  if (error instanceof TypeError) return true; // Network error
  if (error instanceof ShopifyGraphQLThrottleError) return true;
  return false;
}

function extractThrottleInfo(
  errors: GraphQLError[],
): GraphQLCostExtension | null {
  for (const err of errors) {
    if (err.extensions?.code === "THROTTLED" && err.extensions?.cost) {
      return err.extensions.cost as GraphQLCostExtension;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Client implementation
// ---------------------------------------------------------------------------

export class ShopifyGraphQLClient {
  private readonly endpoint: string;

  constructor(
    public readonly shop: string,
    private readonly accessToken: string,
  ) {
    this.endpoint = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  }

  /**
   * Execute a GraphQL query/mutation against the Shopify Admin API.
   *
   * Automatically retries on:
   * - THROTTLED errors (waits exactly the right amount of time)
   * - Network errors (exponential backoff)
   * - 5xx responses (exponential backoff)
   *
   * @param query  The GraphQL query or mutation string
   * @param variables  Variables to pass to the query
   * @returns The `data` field of the GraphQL response
   * @throws ShopifyGraphQLError for permanent errors (auth, bad query, etc.)
   */
  async query<T>(
    query: string,
    variables: Record<string, unknown> = {},
  ): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < MAX_RETRIES) {
      try {
        const result = await this.executeOnce<T>(query, variables);
        return result;
      } catch (error) {
        lastError = error;
        attempt++;

        if (error instanceof ShopifyGraphQLThrottleError) {
          // Wait exactly the time Shopify says to wait
          console.log(
            `[graphql-client][${this.shop}] Throttled, waiting ${error.waitMs}ms (attempt ${attempt}/${MAX_RETRIES})`,
          );
          await sleep(error.waitMs);
          continue;
        }

        if (isTransientError(error)) {
          const backoffMs = Math.min(
            INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1),
            MAX_RETRY_DELAY_MS,
          );
          console.warn(
            `[graphql-client][${this.shop}] Transient error on attempt ${attempt}, retrying in ${backoffMs}ms:`,
            error instanceof Error ? error.message : error,
          );
          await sleep(backoffMs);
          continue;
        }

        // Non-retryable error — rethrow immediately
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Single HTTP request — no retry logic here.
   */
  private async executeOnce<T>(
    query: string,
    variables: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": this.accessToken,
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "(no body)");
      throw new ShopifyGraphQLError(
        `HTTP ${response.status}: ${body}`,
        [],
        this.shop,
      );
    }

    const json = (await response.json()) as GraphQLResponse<T>;

    // Check for GraphQL-level errors
    if (json.errors && json.errors.length > 0) {
      const throttleInfo = extractThrottleInfo(json.errors);

      if (throttleInfo) {
        const waitMs = computeThrottleWaitMs(throttleInfo);
        throw new ShopifyGraphQLThrottleError(this.shop, json.errors, waitMs);
      }

      // Other GraphQL errors — non-retryable
      const messages = json.errors.map((e) => e.message).join("; ");
      throw new ShopifyGraphQLError(
        `GraphQL errors: ${messages}`,
        json.errors,
        this.shop,
      );
    }

    if (json.data === undefined) {
      throw new ShopifyGraphQLError(
        "GraphQL response has no data field",
        [],
        this.shop,
      );
    }

    return json.data;
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createGraphQLClient(
  shop: string,
  accessToken: string,
): ShopifyGraphQLClient {
  return new ShopifyGraphQLClient(shop, accessToken);
}
