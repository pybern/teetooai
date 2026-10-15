import type { NumberFormat } from "../types";

export function fmt(value: number | null | undefined, f: NumberFormat = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const decimals = f.decimals ?? 1;
  const negative = value < 0;
  const abs = Math.abs(value);
  const body = abs.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const prefix = f.prefix === "+" ? (negative ? "−" : "+") : (negative ? "−" : "") + (f.prefix ?? "");
  return `${prefix}${body}${f.suffix ?? ""}`;
}

export function fmtCompact(value: number | null | undefined, f: NumberFormat = {}): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const decimals = Math.min(f.decimals ?? 1, Math.abs(value) >= 100 ? 0 : 1);
  if (!f.suffix && Math.abs(value) >= 10000) {
    return `${value < 0 ? "−" : ""}${f.prefix ?? ""}${(Math.abs(value) / 1000).toFixed(0)}k`;
  }
  return fmt(value, { ...f, decimals });
}

export function pct(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

export function points(value: number, decimals = 1): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)} pts`;
}

export function multiple(value: number): string {
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}×`;
}

export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
