# Detection Engine — Detector Authoring Guide

This directory contains all detector implementations for the ProfitLens Detection Engine.

---

## Architecture Overview

```
src/core/detection/
├── types.ts          ← All shared interfaces & types (IDetector, DetectorContext, etc.)
├── registry.ts       ← DetectorRegistry — stores and retrieves IDetector instances
├── engine.ts         ← DetectionEngine — orchestrates execution through the registry
└── detectors/
    ├── README.md     ← You are here
    └── <name>.ts     ← One file per detector
```

The engine depends on the registry. The registry depends on `IDetector`. Detectors depend only on `types.ts`. Nothing in this folder knows about the engine or the registry — that dependency always flows inward, never outward.

---

## How to Add a New Detector

### Step 1 — Create the detector file

Create `src/core/detection/detectors/<detector-name>.ts`.

```ts
// src/core/detection/detectors/my-detector.ts

import type { IDetector, DetectorContext, DetectorResult } from "../types";

export class MyDetector implements IDetector {
  readonly type = "my_detector_type" as const; // must match detector_type DB enum
  readonly name = "My Detector";              // matches DETECTOR_META[type].label

  async run(context: DetectorContext): Promise<DetectorResult> {
    const start = Date.now();

    // 1. Guard: do you have enough data?
    // If not, return status: "skipped" — never throw.
    if (!context.shopId) {
      return {
        detectorType: this.type,
        status: "skipped",
        anomaliesFound: false,
        message: "No shopId in context.",
        durationMs: Date.now() - start,
      };
    }

    // 2. Run your analysis
    // At this stage detectors DO NOT access the DB.
    // Data will be provided via context when the persistence layer is ready.

    // 3. Return a result
    return {
      detectorType: this.type,
      status: "ok",
      anomaliesFound: false,
      message: "No anomalies found.",
      durationMs: Date.now() - start,
    };
  }
}
```

### Step 2 — Add the type to the database enum (if new)

If your detector type is not already in the `detector_type` Postgres enum, add it in `src/db/schema.ts`:

```ts
export const detectorTypeEnum = pgEnum("detector_type", [
  "refund_leak",
  "shipping_leak",
  "my_detector_type", // ← add here
]);
```

Then run `npx drizzle-kit push` to apply the schema change.

### Step 3 — Add display metadata

Add an entry to `DETECTOR_META` in `src/lib/detectors.ts`:

```ts
export const DETECTOR_META = {
  // ... existing entries
  my_detector_type: {
    label: "My Detector",
    shortLabel: "My Detector",
    description: "What this detector finds.",
    accent: "violet",
  },
};
```

### Step 4 — Register the detector

Register your detector on the `defaultRegistry` (or a custom one) before the engine runs. A good place is an `initDetectors()` call in the entry point that triggers detection (e.g. a cron route, a sync hook, or an API route):

```ts
import { defaultRegistry } from "@/core/detection/registry";
import { MyDetector } from "@/core/detection/detectors/my-detector";

defaultRegistry.register(new MyDetector());
```

That's it. The engine discovers the detector automatically through the registry — `engine.ts` never needs to change.

---

## IDetector Contract

Every detector **must** satisfy these rules:

| Rule | Reason |
|------|--------|
| Implement `IDetector` from `types.ts` | Type safety — the engine only accepts `IDetector` |
| `run()` **must never throw** | One failing detector must not abort the whole run |
| `run()` **must not write to the DB** | Detectors are analysis-only; persistence is a future layer |
| `run()` **must not mutate `context`** | Context is a shared read-only snapshot |
| `run()` **must be idempotent** | Same context → equivalent result, every time |
| `type` **must match the DB enum** | The engine logs and future writers use `detectorType` as a key |

---

## DetectorContext

The engine passes a `DetectorContext` to every detector. It currently carries:

| Field | Type | Description |
|-------|------|-------------|
| `shopId` | `string` | Internal UUID of the shop |
| `shopDomain` | `string` | `myshopify.com` domain |
| `currency` | `string` | ISO-4217 currency code |
| `runAt` | `Date` | UTC timestamp the engine started — use this as "now" |
| `meta` | `Record<string, unknown>` | Opaque key/value metadata attached by the caller |

When the persistence layer is built, additional fields (pre-loaded orders, refunds, products) will be added to `DetectorContext` so detectors receive all the data they need without touching the DB directly.

---

## DetectorResult

| Field | Type | Description |
|-------|------|-------------|
| `detectorType` | `DetectorType` | Must equal `this.type` |
| `status` | `"ok" \| "skipped" \| "error"` | Outcome of the run |
| `anomaliesFound` | `boolean` | True if something actionable was found |
| `message` | `string` | Human-readable summary for logs |
| `durationMs` | `number` | How long the detector took |
| `payload` | `unknown` (optional) | Structured signal data for future persistence |

---

## Existing Detectors

| Type | File | Status |
|------|------|--------|
| `refund_leak` | _(planned)_ | Not yet implemented |
| `shipping_leak` | _(planned)_ | Not yet implemented |

---

## Testing

Create each detector in isolation — no engine, no registry, no DB:

```ts
import { MyDetector } from "@/core/detection/detectors/my-detector";
import type { DetectorContext } from "@/core/detection/types";

const ctx: DetectorContext = {
  shopId: "test-shop-id",
  shopDomain: "test.myshopify.com",
  currency: "USD",
  runAt: new Date(),
  meta: {},
};

const detector = new MyDetector();
const result = await detector.run(ctx);

expect(result.status).toBe("ok");
```
