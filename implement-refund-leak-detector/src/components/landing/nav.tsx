import Link from "next/link";
import { Sparkles } from "lucide-react";

export function LandingNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/[0.06] bg-[#08090c]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-400 to-indigo-600">
            <Sparkles className="h-4 w-4 text-white" strokeWidth={2.5} />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-white">ProfitLens</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm font-medium text-slate-400 md:flex">
          <a href="#how-it-works" className="hover:text-white">How it works</a>
          <a href="#detectors" className="hover:text-white">Detectors</a>
          <a href="#pricing" className="hover:text-white">Pricing</a>
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/dashboard"
            className="hidden text-sm font-medium text-slate-300 hover:text-white sm:block"
          >
            View demo
          </Link>
          <Link
            href="/dashboard"
            className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Install on Shopify
          </Link>
        </div>
      </div>
    </header>
  );
}
