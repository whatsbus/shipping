/**
 * Detection Engine — Detector Registry
 *
 * A lightweight, Map-based registry that holds IDetector instances indexed
 * by their DetectorType key.
 *
 * Responsibilities:
 * - Store detectors at startup (or lazily via register()).
 * - Provide lookup by type and iteration over all detectors.
 * - Enforce uniqueness: registering the same type twice is a programming
 *   error and throws immediately to fail fast during development.
 *
 * The registry is intentionally decoupled from the engine:
 * - The engine depends on the registry (via constructor injection).
 * - The registry knows nothing about the engine.
 * - Detectors know nothing about the registry or the engine.
 *
 * Extension strategy:
 * To add a new detector, create it in src/core/detection/detectors/ and
 * call registry.register(new MyDetector()) before running the engine.
 * No changes to registry.ts or engine.ts are required.
 */

import type { IDetector, DetectorType } from "./types";

// ---------------------------------------------------------------------------
// DetectorRegistry
// ---------------------------------------------------------------------------

export class DetectorRegistry {
  private readonly _detectors: Map<DetectorType, IDetector> = new Map();

  /**
   * Register a detector instance.
   *
   * @throws {Error} if a detector with the same type is already registered.
   *
   * @example
   * const registry = new DetectorRegistry();
   * registry.register(new RefundLeakDetector());
   * registry.register(new ShippingLeakDetector());
   */
  register(detector: IDetector): this {
    if (this._detectors.has(detector.type)) {
      throw new Error(
        `[DetectorRegistry] Detector "${detector.type}" is already registered. ` +
          `Each detector type must be registered exactly once.`,
      );
    }

    this._detectors.set(detector.type, detector);

    console.log(`[DetectorRegistry] Registered detector: ${detector.name} (${detector.type})`);

    return this;
  }

  /**
   * Retrieve a single detector by its type.
   *
   * @returns The detector instance, or `undefined` if not registered.
   */
  get(type: DetectorType): IDetector | undefined {
    return this._detectors.get(type);
  }

  /**
   * Check whether a detector type is registered.
   */
  has(type: DetectorType): boolean {
    return this._detectors.has(type);
  }

  /**
   * Return all registered detectors as an ordered array.
   * Order matches the order in which detectors were registered.
   */
  getAll(): IDetector[] {
    return Array.from(this._detectors.values());
  }

  /**
   * Return the registered detector types.
   */
  getRegisteredTypes(): DetectorType[] {
    return Array.from(this._detectors.keys());
  }

  /**
   * Total number of registered detectors.
   */
  get size(): number {
    return this._detectors.size;
  }
}

// ---------------------------------------------------------------------------
// Default singleton registry
//
// A shared registry instance that can be imported and populated at
// application startup. Using a singleton avoids re-registering detectors
// on every engine invocation.
//
// Usage:
//   import { defaultRegistry } from "@/core/detection/registry";
//   defaultRegistry.register(new MyDetector());
//
// For tests, create a fresh DetectorRegistry() instead of using this
// singleton to avoid cross-test pollution.
// ---------------------------------------------------------------------------

export const defaultRegistry = new DetectorRegistry();
