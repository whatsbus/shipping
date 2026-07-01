import type { ReactNode } from "react";

export function MetricCard({
  label,
  value,
  caption,
  tone = "default",
  icon,
}: {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  tone?: "default" | "negative" | "positive";
  icon?: ReactNode;
}) {
  const valueTone =
    tone === "negative"
      ? "text-rose-400"
      : tone === "positive"
        ? "text-emerald-400"
        : "text-white";

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-6">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        {icon ? <div className="text-slate-500">{icon}</div> : null}
      </div>
      <p className={`mt-3 text-[2.25rem] font-semibold leading-none tracking-tight tabular-nums ${valueTone}`}>
        {value}
      </p>
      {caption ? <p className="mt-3 text-sm text-slate-500">{caption}</p> : null}
    </div>
  );
}
