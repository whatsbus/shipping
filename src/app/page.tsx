import Link from "next/link";
import {
  ArrowRight,
  Receipt,
  Truck,
  Plug,
  ScanSearch,
  Siren,
  CircleDollarSign,
  Check,
  Gauge,
} from "lucide-react";
import { LandingNav } from "@/components/landing/nav";

export const dynamic = "force-dynamic";

const HOW_IT_WORKS = [
  {
    icon: Plug,
    title: "Connect Shopify",
    description: "Install ProfitLens and securely connect your store in under two minutes. No setup required.",
  },
  {
    icon: ScanSearch,
    title: "We analyze your data",
    description: "Orders, refunds, products, and shipping are continuously scanned for patterns that cost you money.",
  },
  {
    icon: Siren,
    title: "Leaks get detected",
    description: "Every leak is explained in plain English — what happened, why, and exactly how much it's costing you.",
  },
  {
    icon: CircleDollarSign,
    title: "You recover profit",
    description: "Follow concrete, prioritized recommendations to plug each leak and keep more of every sale.",
  },
];

const PLANS = [
  {
    name: "Starter",
    price: 49,
    tagline: "For new stores just getting visibility",
    features: ["Up to 300 orders / month", "Refund Leak detector", "Weekly email digest", "1 connected store"],
  },
  {
    name: "Growth",
    price: 129,
    tagline: "For growing stores ready to plug leaks fast",
    features: [
      "Up to 2,000 orders / month",
      "Refund Leak + Shipping Leak detectors",
      "Instant alerts on new findings",
      "Priority support",
    ],
    highlighted: true,
  },
  {
    name: "Pro",
    price: 299,
    tagline: "For high-volume stores that can't afford leaks",
    features: ["Unlimited orders", "All current & future detectors", "Custom alert thresholds", "Dedicated onboarding"],
  },
];

export default function LandingPage() {
  return (
    <div className="bg-[#08090c]">
      <LandingNav />

      {/* Hero */}
      <section className="relative overflow-hidden bg-grid bg-radial-fade">
        <div className="mx-auto flex max-w-6xl flex-col items-center px-6 pb-20 pt-24 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs font-medium text-slate-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Built for Shopify merchants
          </div>

          <h1 className="mt-6 max-w-3xl text-[2.75rem] font-semibold leading-[1.08] tracking-tight text-white sm:text-6xl">
            Find out where your store is quietly losing money.
          </h1>

          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-400">
            ProfitLens connects to Shopify, scans your orders, refunds, and shipping, and shows you exactly
            where profit is leaking — with clear steps to get it back.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
            >
              Install on Shopify — it&apos;s free
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/dashboard"
              className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.06]"
            >
              View live demo
            </Link>
          </div>
          <p className="mt-4 text-xs text-slate-600">No credit card required · 14-day free trial</p>

          {/* Product preview */}
          <div className="mt-16 w-full max-w-4xl rounded-2xl border border-white/[0.08] bg-[#0d0f13] p-3 shadow-[0_40px_120px_-30px_rgba(124,107,240,0.35)]">
            <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-3 pb-3">
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
              <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            </div>
            <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-left">
                <p className="text-xs font-medium text-slate-500">Active monthly leak</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-rose-400">$5,350</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-left">
                <p className="text-xs font-medium text-slate-500">Recovered to date</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-emerald-400">$4,200</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-left">
                <p className="text-xs font-medium text-slate-500">Projected annual impact</p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-white">$64,200</p>
              </div>
            </div>
            <div className="flex flex-col gap-2 px-5 pb-5">
              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-left">
                <div className="flex items-center gap-3">
                  <Truck className="h-4 w-4 text-amber-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Canada orders are shipped at a loss</p>
                    <p className="text-xs text-slate-500">58 affected orders</p>
                  </div>
                </div>
                <p className="text-sm font-semibold tabular-nums text-rose-400">-$1,860/mo</p>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.015] px-4 py-3 text-left">
                <div className="flex items-center gap-3">
                  <Receipt className="h-4 w-4 text-rose-400" />
                  <div>
                    <p className="text-sm font-medium text-white">Scented Candle Trio has a runaway refund rate</p>
                    <p className="text-xs text-slate-500">34 affected orders</p>
                  </div>
                </div>
                <p className="text-sm font-semibold tabular-nums text-rose-400">-$1,240/mo</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-t border-white/[0.06] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-violet-400">The problem</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Your P&amp;L looks fine. Your margin doesn&apos;t.
            </h2>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                title: "Refunds pile up quietly",
                body: "A defective batch, a lenient policy, a support shortcut — each one looks small until you add up a quarter of them.",
              },
              {
                title: "Shipping rates go stale",
                body: "Carrier costs rise every few months. Your checkout rates don't, until you're paying customers to buy from you.",
              },
              {
                title: "Nobody has time to dig",
                body: "The data is buried across orders, refunds, and shipping reports. You need answers, not another dashboard to interpret.",
              },
            ].map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
                <h3 className="text-base font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="border-t border-white/[0.06] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-violet-400">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              From connected store to recovered profit.
            </h2>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((step, i) => {
              const Icon = step.icon;
              return (
                <div key={step.title} className="flex flex-col gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/[0.07] bg-white/[0.03]">
                    <Icon className="h-5 w-5 text-violet-400" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Step {i + 1}</p>
                    <p className="mt-1 text-base font-semibold text-white">{step.title}</p>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{step.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Detectors */}
      <section id="detectors" className="border-t border-white/[0.06] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-violet-400">Detectors</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Continuous, automated profit leak detection.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-400">
              Each detector is a specialized analysis engine trained to find a specific category of loss.
              More detectors are added every quarter.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/10">
                <Receipt className="h-5 w-5 text-rose-400" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">Refund Leak Detector</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Finds refunds that quietly erode margin: over-refunding, missing restocks, repeat offenders,
                and SKUs with anomalous return rates.
              </p>
              <ul className="mt-5 flex flex-col gap-2">
                {[
                  "SKU-level refund rate anomalies",
                  "Repeat-refunder customer detection",
                  "Returns without inventory restock",
                  "Refunds that exceed original order value",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-8">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
                <Truck className="h-5 w-5 text-amber-400" />
              </div>
              <h3 className="mt-5 text-lg font-semibold text-white">Shipping Leak Detector</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Finds orders where you charge less for shipping than it actually costs you — by zone, carrier,
                weight, or threshold.
              </p>
              <ul className="mt-5 flex flex-col gap-2">
                {[
                  "Zone-level carrier cost vs. charged rate",
                  "Free-shipping threshold analysis",
                  "Express surcharge gap detection",
                  "Weight-based rate accuracy checks",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Social proof */}
      <section className="border-t border-white/[0.06] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {[
              {
                quote: "We were losing $2,100 a month on Canadian shipping and had no idea. ProfitLens caught it in the first week.",
                author: "Sarah M.",
                role: "Founder, outdoor gear brand · $3.2M ARR",
              },
              {
                quote: "One finding paid for three years of subscription. The ROI is embarrassingly obvious.",
                author: "Marcus T.",
                role: "COO, home goods DTC · 4,000 orders/mo",
              },
              {
                quote: "Finally a tool that tells me what to do, not just shows me a chart I have to interpret.",
                author: "Priya K.",
                role: "Operations lead, beauty brand · Shopify Plus",
              },
            ].map((testimonial) => (
              <div
                key={testimonial.author}
                className="flex flex-col gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6"
              >
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <svg key={i} className="h-4 w-4 fill-amber-400" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="flex-1 text-sm leading-relaxed text-slate-300">&ldquo;{testimonial.quote}&rdquo;</p>
                <div>
                  <p className="text-sm font-semibold text-white">{testimonial.author}</p>
                  <p className="text-xs text-slate-500">{testimonial.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-white/[0.06] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-violet-400">Pricing</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
              Pay once. Recover many times over.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-400">
              Every plan includes a 14-day free trial. No credit card required to start.
            </p>
          </div>

          <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`flex flex-col rounded-2xl border p-8 ${
                  plan.highlighted
                    ? "border-violet-500/40 bg-violet-500/[0.06]"
                    : "border-white/[0.07] bg-white/[0.02]"
                }`}
              >
                {plan.highlighted && (
                  <div className="mb-4 inline-flex w-fit items-center rounded-full bg-violet-500/20 px-2.5 py-1 text-xs font-semibold text-violet-300 ring-1 ring-inset ring-violet-500/30">
                    Most popular
                  </div>
                )}
                <p className="text-base font-semibold text-white">{plan.name}</p>
                <p className="mt-1 text-sm text-slate-500">{plan.tagline}</p>
                <p className="mt-6 text-4xl font-semibold tabular-nums text-white">
                  ${plan.price}
                  <span className="text-base font-normal text-slate-500">/mo</span>
                </p>
                <ul className="mt-6 flex flex-1 flex-col gap-3">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-slate-300">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/dashboard"
                  className={`mt-8 flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 ${
                    plan.highlighted
                      ? "bg-white text-black"
                      : "border border-white/10 bg-white/[0.04] text-slate-200"
                  }`}
                >
                  Start free trial
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-t border-white/[0.06] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="rounded-3xl border border-violet-500/20 bg-violet-500/[0.05] px-8 py-16 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-indigo-600">
              <Gauge className="h-7 w-7 text-white" />
            </div>
            <h2 className="mt-6 text-3xl font-semibold tracking-tight text-white">
              See what ProfitLens finds in your store.
            </h2>
            <p className="mt-4 max-w-md mx-auto text-base leading-relaxed text-slate-400">
              The average store leaks 4–8% of revenue every month. Most of it is findable and fixable
              in under a week.
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Install on Shopify — it&apos;s free
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/dashboard"
                className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-white/[0.06]"
              >
                View live demo
              </Link>
            </div>
            <p className="mt-4 text-xs text-slate-600">No credit card required · 14-day free trial · Cancel any time</p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] px-6 py-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <p className="text-xs text-slate-600">© 2025 ProfitLens. All rights reserved.</p>
          <div className="flex items-center gap-6 text-xs text-slate-600">
            <a href="#" className="hover:text-slate-400">Privacy</a>
            <a href="#" className="hover:text-slate-400">Terms</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
