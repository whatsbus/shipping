import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { SeverityBadge, StatusBadge, DetectorBadge } from "@/components/ui/badges";
import { formatMoney, formatShortDate } from "@/lib/format";
import type { findings } from "@/db/schema";

type Finding = typeof findings.$inferSelect;

export function FindingRow({ finding, currency }: { finding: Finding; currency: string }) {
  const isResolved = finding.status === "resolved" || finding.status === "ignored";
  const impact = isResolved ? Number(finding.recoveredAmount) : Number(finding.monthlyImpact);

  return (
    <Link
      href={`/findings/${finding.id}`}
      className="group flex items-center justify-between gap-6 rounded-xl border border-white/[0.06] bg-white/[0.015] px-5 py-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.035]"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <DetectorBadge type={finding.detectorType} />
          <SeverityBadge severity={finding.severity} />
          <StatusBadge status={finding.status} />
        </div>
        <p className="mt-2.5 truncate text-[15px] font-medium text-white">{finding.title}</p>
        <p className="mt-1 truncate text-sm text-slate-500">
          {finding.affectedOrdersCount} affected orders · Last detected {formatShortDate(finding.lastDetectedAt)}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-4 text-right">
        <div>
          <p
            className={`text-lg font-semibold tabular-nums ${isResolved ? "text-emerald-400" : "text-rose-400"}`}
          >
            {isResolved ? "+" : "-"}
            {formatMoney(impact, currency)}
          </p>
          <p className="text-xs text-slate-500">{isResolved ? "recovered" : "per month"}</p>
        </div>
        <ArrowUpRight className="h-4 w-4 text-slate-600 transition-colors group-hover:text-slate-300" />
      </div>
    </Link>
  );
}
