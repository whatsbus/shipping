import type { detectorTypeEnum } from "@/db/schema";

export type DetectorType = (typeof detectorTypeEnum.enumValues)[number];

export const DETECTOR_META: Record<
  DetectorType,
  { label: string; shortLabel: string; description: string; accent: string }
> = {
  refund_leak: {
    label: "Refund Leak",
    shortLabel: "Refunds",
    description:
      "Finds refunds that quietly erode margin: over-refunding, missing restocks, and repeat offenders.",
    accent: "rose",
  },
  shipping_leak: {
    label: "Shipping Leak",
    shortLabel: "Shipping",
    description:
      "Finds orders where you charge less for shipping than it actually costs you to ship.",
    accent: "amber",
  },
};

export const SEVERITY_META = {
  critical: { label: "Critical", dot: "bg-rose-500", text: "text-rose-400", bg: "bg-rose-500/10", ring: "ring-rose-500/20" },
  warning: { label: "Warning", dot: "bg-amber-500", text: "text-amber-400", bg: "bg-amber-500/10", ring: "ring-amber-500/20" },
  info: { label: "Info", dot: "bg-sky-500", text: "text-sky-400", bg: "bg-sky-500/10", ring: "ring-sky-500/20" },
} as const;

export const STATUS_META = {
  new: { label: "New", text: "text-violet-300", bg: "bg-violet-500/10", ring: "ring-violet-500/20" },
  investigating: { label: "Investigating", text: "text-amber-300", bg: "bg-amber-500/10", ring: "ring-amber-500/20" },
  resolved: { label: "Resolved", text: "text-emerald-300", bg: "bg-emerald-500/10", ring: "ring-emerald-500/20" },
  ignored: { label: "Ignored", text: "text-slate-400", bg: "bg-slate-500/10", ring: "ring-slate-500/20" },
} as const;
