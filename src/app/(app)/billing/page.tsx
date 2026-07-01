import { Wallet, TrendingUp, Check } from "lucide-react";
import { Topbar } from "@/components/app/topbar";
import { PlanSelectButton } from "@/components/app/plan-select-button";
import { getCurrentShop, getBillingForShop, getFindingsForShop, computeShopMetrics } from "@/lib/data";
import { formatMoney, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const PLANS = [
  {
    id: "starter" as const,
    name: "Starter",
    price: 49,
    tagline: "For new stores just getting visibility",
    features: [
      "Up to 300 orders / month",
      "Refund Leak detector",
      "Weekly email digest",
      "1 connected store",
    ],
  },
  {
    id: "growth" as const,
    name: "Growth",
    price: 129,
    tagline: "For growing stores ready to plug leaks fast",
    features: [
      "Up to 2,000 orders / month",
      "Refund Leak + Shipping Leak detectors",
      "Instant alerts on new findings",
      "Priority support",
    ],
  },
  {
    id: "pro" as const,
    name: "Pro",
    price: 299,
    tagline: "For high-volume stores that can't afford leaks",
    features: [
      "Unlimited orders",
      "All current & future detectors",
      "Custom alert thresholds",
      "Dedicated onboarding",
    ],
  },
];

export default async function BillingPage() {
  const shop = await getCurrentShop();
  const [subscription, allFindings] = await Promise.all([
    getBillingForShop(shop.id),
    getFindingsForShop(shop.id),
  ]);
  const metrics = computeShopMetrics(allFindings);

  const priceMonthly = Number(subscription?.priceMonthly ?? 0);
  const roi = priceMonthly > 0 ? metrics.recoveredToDate / priceMonthly : 0;

  return (
    <div>
      <Topbar title="Billing" description="Your plan, usage, and return on investment." />

      <div className="mx-auto max-w-6xl px-8 py-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-6 lg:col-span-2">
            <div className="flex items-center gap-2 text-emerald-300">
              <Wallet className="h-4 w-4" />
              <p className="text-sm font-medium">Return on investment</p>
            </div>
            <p className="mt-3 text-4xl font-semibold tabular-nums text-white">
              {formatMoney(metrics.recoveredToDate, shop.currency)}
              <span className="text-lg font-normal text-slate-500"> recovered</span>
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              You&apos;re paying {formatMoney(priceMonthly, shop.currency)}/mo and ProfitLens has already
              helped you recover {roi > 0 ? `${roi.toFixed(1)}x` : "0x"} that amount from fixed profit
              leaks — plus {formatMoney(metrics.activeMonthlyLeak, shop.currency)}/mo still on the table.
            </p>
          </div>

          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
            <div className="flex items-center gap-2 text-slate-400">
              <TrendingUp className="h-4 w-4" />
              <p className="text-sm font-medium">Current plan</p>
            </div>
            <p className="mt-3 text-2xl font-semibold text-white">
              {subscription ? `${subscription.planName[0].toUpperCase()}${subscription.planName.slice(1)}` : "—"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {formatMoney(priceMonthly, shop.currency)}/month
            </p>
            {subscription?.currentPeriodEnd ? (
              <p className="mt-3 text-xs text-slate-500">
                Renews {formatDate(subscription.currentPeriodEnd)}
              </p>
            ) : null}
          </div>
        </div>

        <section className="mt-10">
          <h2 className="text-base font-semibold text-white">Plans</h2>
          <p className="mt-1 text-sm text-slate-500">
            Every plan includes both detectors on a scale that matches your order volume.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLANS.map((plan) => {
              const isCurrent = subscription?.planName === plan.id;
              return (
                <div
                  key={plan.id}
                  className={`flex flex-col rounded-2xl border p-6 ${
                    isCurrent
                      ? "border-violet-500/40 bg-violet-500/[0.06]"
                      : "border-white/[0.07] bg-white/[0.02]"
                  }`}
                >
                  <p className="text-sm font-semibold text-white">{plan.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{plan.tagline}</p>
                  <p className="mt-4 text-3xl font-semibold tabular-nums text-white">
                    ${plan.price}
                    <span className="text-sm font-normal text-slate-500">/mo</span>
                  </p>
                  <ul className="mt-5 flex flex-1 flex-col gap-2.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-6">
                    <PlanSelectButton planName={plan.id} isCurrent={isCurrent} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
