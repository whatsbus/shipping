const currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string, maximumFractionDigits = 0) {
  const key = `${currency}-${maximumFractionDigits}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits,
      minimumFractionDigits: maximumFractionDigits,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

export function formatMoney(
  value: number | string,
  currency = "USD",
  options?: { showCents?: boolean },
) {
  const numeric = typeof value === "string" ? Number(value) : value;
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const showCents = options?.showCents ?? Math.abs(safe) < 1000;
  return getCurrencyFormatter(currency, showCents ? 2 : 0).format(safe);
}

export function formatCompactMoney(value: number | string, currency = "USD") {
  const numeric = typeof value === "string" ? Number(value) : value;
  const safe = Number.isFinite(numeric) ? numeric : 0;
  const sign = safe < 0 ? "-" : "";
  const abs = Math.abs(safe);
  const symbol = currency === "USD" ? "$" : `${currency} `;
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(1)}k`;
  return formatMoney(safe, currency);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatPercent(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

export function formatRelativeTime(date: Date) {
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  if (diffMinutes < 1) return "just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.round(diffDays / 30);
  return `${diffMonths}mo ago`;
}

export function formatDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatShortDate(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}
