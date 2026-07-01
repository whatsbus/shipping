import { SEVERITY_META, STATUS_META, DETECTOR_META, type DetectorType } from "@/lib/detectors";
import type { findingSeverityEnum, findingStatusEnum } from "@/db/schema";
import { Receipt, Truck } from "lucide-react";

type Severity = (typeof findingSeverityEnum.enumValues)[number];
type Status = (typeof findingStatusEnum.enumValues)[number];

export function SeverityBadge({ severity }: { severity: Severity }) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${meta.bg} ${meta.text} ${meta.ring}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${meta.bg} ${meta.text} ${meta.ring}`}
    >
      {meta.label}
    </span>
  );
}

export function DetectorBadge({ type }: { type: DetectorType }) {
  const meta = DETECTOR_META[type];
  const Icon = type === "refund_leak" ? Receipt : Truck;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs font-medium text-slate-300 ring-1 ring-inset ring-white/10">
      <Icon className="h-3.5 w-3.5" strokeWidth={2} />
      {meta.shortLabel}
    </span>
  );
}
