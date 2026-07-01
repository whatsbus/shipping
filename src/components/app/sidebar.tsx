"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Search, CreditCard, Settings, Sparkles } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/findings", label: "Findings", icon: Search },
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ shopName }: { shopName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-r border-white/[0.07] bg-[#0a0b0e] px-4 py-6">
      <Link href="/dashboard" className="flex items-center gap-2 px-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-violet-400 to-indigo-600">
          <Sparkles className="h-4 w-4 text-white" strokeWidth={2.5} />
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-white">ProfitLens</span>
      </Link>

      <nav className="mt-8 flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-white/[0.06] text-white"
                  : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-200"
              }`}
            >
              <Icon
                className={`h-4 w-4 ${isActive ? "text-violet-400" : "text-slate-500 group-hover:text-slate-300"}`}
                strokeWidth={2}
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
        <p className="truncate text-xs font-medium text-slate-300">{shopName}</p>
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-xs text-slate-500">Store connected</span>
        </div>
      </div>
    </aside>
  );
}
