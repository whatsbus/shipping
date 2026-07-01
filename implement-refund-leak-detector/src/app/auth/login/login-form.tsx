"use client";

/**
 * Login Form Component
 *
 * Client component for the install/login flow.
 * Normalizes the shop domain and redirects to the install API route.
 */

import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";

interface LoginFormProps {
  defaultShop?: string;
}

export function LoginForm({ defaultShop = "" }: LoginFormProps) {
  const [shop, setShop] = useState(defaultShop);
  const [isLoading, setIsLoading] = useState(false);
  const [localError, setLocalError] = useState("");

  function normalizeShopDomain(input: string): string {
    let domain = input.trim().toLowerCase();
    // Remove protocol if present
    domain = domain.replace(/^https?:\/\//, "");
    // Remove trailing slash
    domain = domain.replace(/\/$/, "");
    // Append .myshopify.com if not present
    if (!domain.endsWith(".myshopify.com")) {
      domain = `${domain}.myshopify.com`;
    }
    return domain;
  }

  function isValidDomain(domain: string): boolean {
    return /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(domain);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError("");

    const normalizedShop = normalizeShopDomain(shop);

    if (!isValidDomain(normalizedShop)) {
      setLocalError(
        "Please enter a valid Shopify store domain (e.g. my-store or my-store.myshopify.com).",
      );
      return;
    }

    setIsLoading(true);
    window.location.href = `/api/auth/install?shop=${encodeURIComponent(normalizedShop)}`;
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
      <div>
        <label htmlFor="shop" className="block text-xs font-medium text-slate-400 mb-1.5">
          Store domain
        </label>
        <div className="relative">
          <input
            id="shop"
            type="text"
            value={shop}
            onChange={(e) => setShop(e.target.value)}
            placeholder="your-store.myshopify.com"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-lg border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-colors focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30"
            required
          />
        </div>
        <p className="mt-1.5 text-xs text-slate-600">
          Enter just the subdomain — e.g. <span className="text-slate-500">my-store</span>
        </p>
      </div>

      {localError && (
        <p className="text-xs text-rose-400">{localError}</p>
      )}

      <button
        type="submit"
        disabled={isLoading || !shop.trim()}
        className="flex items-center justify-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
            Connecting…
          </>
        ) : (
          <>
            Install ProfitLens
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
    </form>
  );
}
