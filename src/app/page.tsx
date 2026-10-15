import { Suspense } from "react";
import { MarketStrip } from "@/components/market-strip";
import { Workspace } from "@/components/workspace";
import { getMarketSummary } from "@/lib/market-summary";

export default function Home() {
  const summary = getMarketSummary();
  return (
    <Suspense fallback={<div className="mx-auto h-96 w-full max-w-6xl animate-pulse rounded-3xl bg-white/[0.02] md:mt-6" />}>
      <Workspace marketStrip={<MarketStrip summary={summary} />} />
    </Suspense>
  );
}
