import type { ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import { formatRelativeTime } from "@/lib/format";

export function Topbar({
  title,
  description,
  lastSyncedAt,
  actions,
}: {
  title: string;
  description?: string;
  lastSyncedAt?: Date | null;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.07] bg-[#08090c]/80 px-8 py-6 backdrop-blur">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-white">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
      </div>
      <div className="flex items-center gap-3">
        {lastSyncedAt ? (
          <div className="flex items-center gap-1.5 rounded-full border border-white/[0.07] bg-white/[0.02] px-3 py-1.5 text-xs text-slate-400">
            <RefreshCw className="h-3 w-3" />
            Synced {formatRelativeTime(lastSyncedAt)}
          </div>
        ) : null}
        {actions}
      </div>
    </header>
  );
}
