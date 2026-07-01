/**
 * Detection Engine Setup
 *
 * Initialises the default registry with all registered detectors.
 * Import this module exactly once at the top of any entry point that
 * triggers the detection engine (e.g. an API route).
 *
 * Pattern: call setupDetectors() before running the engine.
 * The registry is a singleton so calling it multiple times is safe
 * (the duplicate-registration guard in DetectorRegistry will throw
 * on the second call, so use the `initialized` flag below).
 *
 * Extension guide:
 *   To add a new detector:
 *     1. Create src/core/detection/detectors/<name>.ts
 *     2. Import it here and call defaultRegistry.register(new MyDetector())
 *   That's it — engine.ts never changes.
 */

import { defaultRegistry } from "./registry";
import { RefundLeakDetector } from "./detectors/refund-leak";

let initialized = false;

/**
 * Register all detectors on the default registry.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function setupDetectors(): void {
  if (initialized) return;
  initialized = true;

  defaultRegistry.register(new RefundLeakDetector());

  // Future: defaultRegistry.register(new ShippingLeakDetector());
}
