"use client";

import { useTransition } from "react";
import { changePlan } from "@/app/(app)/billing/actions";

type PlanName = "starter" | "growth" | "pro";

export function PlanSelectButton({
  planName,
  isCurrent,
}: {
  planName: PlanName;
  isCurrent: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  if (isCurrent) {
    return (
      <button
        type="button"
        disabled
        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-medium text-slate-400"
      >
        Current plan
      </button>
    );
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={() => startTransition(() => changePlan(planName))}
      className="w-full rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
    >
      {isPending ? "Updating..." : `Switch to ${planName[0].toUpperCase()}${planName.slice(1)}`}
    </button>
  );
}
