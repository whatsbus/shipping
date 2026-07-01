import Link from "next/link";
import { Topbar } from "@/components/app/topbar";
import { FindingRow } from "@/components/app/finding-row";
import { getCurrentShop, getFindingsForShop } from "@/lib/data";
import { formatMoney } from "@/lib/format";
import { DETECTOR_META, STATUS_META, type DetectorType } from "@/lib/detectors";
import type { findingStatusEnum } from "@/db/schema";

export const dynamic = "force-dynamic";

type Status = (typeof findingStatusEnum.enumValues)[number];

const DETECTOR_FILTERS: { value: DetectorType | "all"; label: string }[] = [
  { value: "all", label: "All detectors" },
  { value: "refund_leak", label: DETECTOR_META.refund_leak.label },
  { value: "shipping_leak", label: DETECTOR_META.shipping_leak.label },
];

const STATUS_FILTERS: { value: Status | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "new", label: STATUS_META.new.label },
  { value: "investigating", label: STATUS_META.investigating.label },
  { value: "resolved", label: STATUS_META.resolved.label },
  { value: "ignored", label: STATUS_META.ignored.label },
];

function buildHref(detector: string, status: string) {
  const params = new URLSearchParams();
  if (detector !== "all") params.set("detector", detector);
  if (status !== "all") params.set("status", status);
  const qs = params.toString();
  return qs ? `/findings?${qs}` : "/findings";
}

export default async function FindingsPage({
  searchParams,
}: {
  searchParams: Promise<{ detector?: string; status?: string }>;
}) {
  const params = await searchParams;
  const detectorFilter = (params.detector ?? "all") as DetectorType | "all";
  const statusFilter = (params.status ?? "all") as Status | "all";

  const shop = await getCurrentShop();
  const allFindings = await getFindingsForShop(shop.id);

  const filtered = allFindings.filter((f) => {
    if (detectorFilter !== "all" && f.detectorType !== detectorFilter) return false;
    if (statusFilter !== "all" && f.status !== statusFilter) return false;
    return true;
  });

  const activeMonthlyAtRisk = filtered
    .filter((f) => f.status === "new" || f.status === "investigating")
    .reduce((sum, f) => sum + Number(f.monthlyImpact), 0);

  return (
    <div>
      <Topbar
        title="Findings"
        description="Every profit leak ProfitLens has detected across your store."
        lastSyncedAt={shop.lastSyncedAt}
      />

      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap gap-2">
            {DETECTOR_FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={buildHref(filter.value, statusFilter)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  detectorFilter === filter.value
                    ? "bg-white text-black"
                    : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"
                }`}
              >
                {filter.label}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={buildHref(detectorFilter, filter.value)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                  statusFilter === filter.value
                    ? "bg-white/[0.12] text-white ring-1 ring-inset ring-white/20"
                    : "bg-white/[0.04] text-slate-400 hover:bg-white/[0.08] hover:text-slate-200"
                }`}
              >
                {filter.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2 text-sm text-slate-500">
          <span className="font-medium text-slate-300">{filtered.length}</span>
          finding{filtered.length === 1 ? "" : "s"}
          {activeMonthlyAtRisk > 0 ? (
            <>
              <span>·</span>
              <span className="font-medium text-rose-400">
                {formatMoney(activeMonthlyAtRisk, shop.currency)}/mo
              </span>
              currently at risk
            </>
          ) : null}
        </div>

        <div className="mt-4 flex flex-col gap-2.5">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-5 py-12 text-center">
              <p className="text-sm text-slate-400">No findings match these filters.</p>
            </div>
          ) : (
            filtered.map((finding) => (
              <FindingRow key={finding.id} finding={finding} currency={shop.currency} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
