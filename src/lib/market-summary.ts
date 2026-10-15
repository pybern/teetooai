import { HK } from "./data/hk";

export type MarketSummary = {
  fetchedAt: string;
  indices: { symbol: string; name: string; last: number; changePct: number | null; spark: number[] }[];
  movers: { symbol: string; name: string; price: number; changePct: number }[];
};

export function getMarketSummary(): MarketSummary {
  const indices = HK.indices
    .filter((i) => i.last != null)
    .map((i) => ({
      symbol: i.symbol,
      name: i.name,
      last: i.last as number,
      changePct: i.changePct,
      spark: i.series.slice(-24).map((p) => p.close),
    }));
  const movers = HK.stocks
    .filter((s) => s.changePct != null)
    .map((s) => ({ symbol: s.symbol, name: s.name, price: s.price, changePct: s.changePct as number }))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, 6);
  return { fetchedAt: HK.fetchedAt, indices, movers };
}
