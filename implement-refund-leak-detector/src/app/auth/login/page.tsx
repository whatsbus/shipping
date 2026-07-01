/**
 * Shopify App Login / Install Page
 *
 * Handles two scenarios:
 *
 * 1. Direct access (no shop param):
 *    Shows a form where merchants can enter their store domain to start
 *    the OAuth install flow.
 *
 * 2. Shop param present (e.g., ?shop=mystore.myshopify.com):
 *    Automatically initiates the OAuth flow for that store.
 *    This happens when Shopify redirects an uninstalled merchant here.
 */

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { LoginForm } from "./login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ shop?: string; error?: string }>;
}) {
  const params = await searchParams;
  const shop = params.shop ?? "";
  const error = params.error;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#08090c] px-6">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-2.5 mb-10">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-400 to-indigo-600">
          <Sparkles className="h-5 w-5 text-white" strokeWidth={2.5} />
        </span>
        <span className="text-xl font-semibold tracking-tight text-white">
          ProfitLens
        </span>
      </Link>

      {/* Card */}
      <div className="w-full max-w-sm rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
        <h1 className="text-lg font-semibold text-white">
          Connect your Shopify store
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Enter your store domain to install ProfitLens and start detecting
          profit leaks.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
            {decodeURIComponent(error)}
          </div>
        )}

        <LoginForm defaultShop={shop} />

        <p className="mt-6 text-center text-xs text-slate-600">
          By installing, you agree to our{" "}
          <Link href="/terms" className="text-slate-400 hover:text-white">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link href="/privacy" className="text-slate-400 hover:text-white">
            Privacy Policy
          </Link>
          .
        </p>
      </div>

      <p className="mt-6 text-xs text-slate-600">
        Already installed?{" "}
        <Link
          href="/dashboard"
          className="text-violet-400 hover:text-violet-300"
        >
          Go to dashboard
        </Link>
      </p>
    </div>
  );
}
