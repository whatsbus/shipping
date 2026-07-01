import Link from "next/link";
import { AlertTriangle, TrendingUp, Wallet, ArrowRight, Receipt, Truck } from "lucide-react";
import { Topbar } from "@/components/app/topbar";
import { MetricCard } from "@/components/ui/metric-card";
import { FindingRow } from "@/components/app/finding-row";
import { getCurrentShop, getFindingsForShop, computeShopMetrics } from "@/lib/data";
import { formatMoney } from "@/lib/format";
import { DETECTOR_META } from "@/lib/detectors";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const shop = await getCurrentShop();
  const allFindings = await getFindingsForShop(shop.id);
  const metrics = computeShopMetrics(allFindings);

  const activeFindings = allFindings.filter(
    (f) => f.status === "new" || f.status === "investigating",
  );
  const topLeaks = [...activeFindings]
    .sort((a, b) => Number(b.monthlyImpact) - Number(a.monthlyImpact))
    .slice(0, 4);

  const detectorTypes = ["refund_leak", "shipping_leak"] as const;
  const detectorSummaries = detectorTypes.map((type) => {
    const forType = allFindings.filter((f) => f.detectorType === type);
    const active = forType.filter((f) => f.status === "new" || f.status === "investigating");
    const monthlyImpact = active.reduce((sum, f) => sum + Number(f.monthlyImpact), 0);
    return { type, count: active.length, monthlyImpact };
  });

  return (
    <div>
      <Topbar
        title="Dashboard"
        description={`Here's where ${shop.name} is losing money right now.`}
        lastSyncedAt={shop.lastSyncedAt}
      />

      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            label="Active monthly leak"
            value={formatMoney(metrics.activeMonthlyLeak, shop.currency)}
            caption="Estimated recurring loss, every month, until fixed"
            tone="negative"
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <MetricCard
            label="Projected annual impact"
            value={formatMoney(metrics.annualizedLeak, shop.currency)}
            caption="If nothing changes over the next 12 months"
            tone="negative"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <MetricCard
            label="Recovered to date"
            value={formatMoney(metrics.recoveredToDate, shop.currency)}
            caption="Profit put back in your pocket by fixes you've made"
            tone="positive"
            icon={<Wallet className="h-4 w-4" />}
          />
          <MetricCard
            label="Active findings"
            value={metrics.activeFindingsCount}
            caption={`${metrics.criticalFindingsCount} marked critical`}
          />
        </div>

        <section className="mt-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Top profit leaks</h2>
              <p className="mt-1 text-sm text-slate-500">Ranked by how much they're costing you every month.</p>
            </div>
            <Link
              href="/findings"
              className="flex items-center gap-1 text-sm font-medium text-violet-400 hover:text-violet-300"
            >
              View all findings
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          <div className="mt-4 flex flex-col gap-2.5">
            {topLeaks.length === 0 ? (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-5 py-10 text-center">
                <p className="text-sm text-slate-400">
                  No active leaks right now — every detected issue has been resolved. Nice work.
                </p>
              </div>
            ) : (
              topLeaks.map((finding) => (
                <FindingRow key={finding.id} finding={finding} currency={shop.currency} />
              ))
            )}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-base font-semibold text-white">Detectors</h2>
          <p className="mt-1 text-sm text-slate-500">
            ProfitLens continuously scans your orders, refunds, and shipping data.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {detectorSummaries.map((detector) => {
              const meta = DETECTOR_META[detector.type];
              const Icon = detector.type === "refund_leak" ? Receipt : Truck;
              return (
                <div
                  key={detector.type}
                  className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.05]">
                        <Icon className="h-4.5 w-4.5 text-slate-300" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-white">{meta.label}</p>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          <span className="text-xs text-slate-500">Active</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-semibold tabular-nums text-rose-400">
                        {formatMoney(detector.monthlyImpact, shop.currency)}
                      </p>
                      <p className="text-xs text-slate-500">{detector.count} open</p>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-slate-400">{meta.description}</p>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
