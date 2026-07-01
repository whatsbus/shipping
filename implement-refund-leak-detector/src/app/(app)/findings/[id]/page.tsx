import Link from "next/link";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import { ArrowLeft, Gauge, ListChecks, Lightbulb, ClipboardList } from "lucide-react";
import { SeverityBadge, StatusBadge, DetectorBadge } from "@/components/ui/badges";
import { FindingStatusActions } from "@/components/app/finding-status-actions";
import { getCurrentShop, getFindingById } from "@/lib/data";
import { formatMoney, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FindingDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const shop = await getCurrentShop();
  const result = await getFindingById(shop.id, id);

  if (!result) notFound();
  const { finding, evidence } = result;

  const isResolved = finding.status === "resolved" || finding.status === "ignored";

  return (
    <div>
      <div className="border-b border-white/[0.07] bg-[#08090c]/80 px-8 py-6 backdrop-blur">
        <Link
          href="/findings"
          className="flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-300"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to findings
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <DetectorBadge type={finding.detectorType} />
              <SeverityBadge severity={finding.severity} />
              <StatusBadge status={finding.status} />
            </div>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-white">{finding.title}</h1>
            <p className="mt-2 text-[15px] leading-relaxed text-slate-400">{finding.summary}</p>
          </div>
          <FindingStatusActions findingId={finding.id} status={finding.status} />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <p className="text-sm font-medium text-slate-400">
              {isResolved ? "Was losing" : "Monthly impact"}
            </p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-rose-400">
              {formatMoney(finding.monthlyImpact === "0.00" ? finding.impactToDate : finding.monthlyImpact, shop.currency)}
              {finding.monthlyImpact !== "0.00" ? <span className="text-base text-slate-500">/mo</span> : null}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <p className="text-sm font-medium text-slate-400">Impact to date</p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-white">
              {formatMoney(finding.impactToDate, shop.currency)}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <p className="text-sm font-medium text-slate-400">
              {isResolved ? "Recovered" : "Potential to recover"}
            </p>
            <p className="mt-3 text-3xl font-semibold tabular-nums text-emerald-400">
              {formatMoney(
                isResolved ? finding.recoveredAmount : Number(finding.monthlyImpact) * 12,
                shop.currency,
              )}
              {!isResolved ? <span className="text-base text-slate-500">/yr</span> : null}
            </p>
          </div>
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <p className="text-sm font-medium text-slate-400">Confidence</p>
            <div className="mt-3 flex items-center gap-2">
              <p className="text-3xl font-semibold tabular-nums text-white">{finding.confidence}%</p>
              <Gauge className="h-5 w-5 text-slate-500" />
            </div>
            <p className="mt-1 text-xs text-slate-500">{finding.affectedOrdersCount} orders analyzed</p>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-5">
          <div className="flex flex-col gap-8 lg:col-span-3">
            <section>
              <SectionHeading icon={ClipboardList} title="What happened" />
              <p className="mt-3 text-[15px] leading-relaxed text-slate-300">{finding.explanation}</p>
            </section>

            <section>
              <SectionHeading icon={Lightbulb} title="Why this is happening" />
              <ul className="mt-3 flex flex-col gap-2.5">
                {finding.rootCauses.map((cause, i) => (
                  <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-slate-300">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-500" />
                    {cause}
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-2xl border border-violet-500/20 bg-violet-500/[0.05] p-6">
              <SectionHeading icon={ListChecks} title="What to do about it" tone="violet" />
              <p className="mt-3 text-[15px] leading-relaxed text-slate-200">{finding.recommendation}</p>
              <ol className="mt-4 flex flex-col gap-2.5">
                {finding.recommendationSteps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-[15px] leading-relaxed text-slate-300">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-300">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="lg:col-span-2">
            <h2 className="text-sm font-semibold text-white">Evidence</h2>
            <p className="mt-1 text-sm text-slate-500">
              A sample of the orders behind this finding.
            </p>
            <div className="mt-4 flex flex-col gap-2">
              {evidence.map((row) => (
                <div
                  key={row.id}
                  className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-4 py-3"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">{row.orderNumber}</span>
                    <span className="text-sm font-medium tabular-nums text-rose-400">
                      -{formatMoney(row.amount, shop.currency)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{formatDate(row.occurredAt)}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{row.note}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
  tone = "default",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  tone?: "default" | "violet";
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={`h-4 w-4 ${tone === "violet" ? "text-violet-400" : "text-slate-500"}`} />
      <h2 className="text-sm font-semibold text-white">{title}</h2>
    </div>
  );
}
