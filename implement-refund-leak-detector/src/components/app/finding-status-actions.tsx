"use client";

import { useTransition } from "react";
import { CheckCircle2, EyeOff, Search, RotateCcw } from "lucide-react";
import { updateFindingStatus } from "@/app/(app)/findings/[id]/actions";

type Status = "new" | "investigating" | "resolved" | "ignored";

export function FindingStatusActions({ findingId, status }: { findingId: string; status: Status }) {
  const [isPending, startTransition] = useTransition();

  function setStatus(next: Status) {
    startTransition(async () => {
      await updateFindingStatus(findingId, next);
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "investigating" && status !== "resolved" && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setStatus("investigating")}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
        >
          <Search className="h-3.5 w-3.5" />
          Investigate
        </button>
      )}
      {status !== "resolved" && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setStatus("resolved")}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-500/15 px-3.5 py-2 text-sm font-medium text-emerald-300 ring-1 ring-inset ring-emerald-500/30 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
        >
          <CheckCircle2 className="h-3.5 w-3.5" />
          Mark as resolved
        </button>
      )}
      {status !== "ignored" && status !== "resolved" && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setStatus("ignored")}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
        >
          <EyeOff className="h-3.5 w-3.5" />
          Ignore
        </button>
      )}
      {(status === "resolved" || status === "ignored") && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => setStatus("new")}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/[0.08] disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reopen
        </button>
      )}
    </div>
  );
}
