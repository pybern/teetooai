/** Bundled HKEX seed coverage (data/hkex/hkex-coverage.json); a test keeps these in sync with the CSV. */
export const HKEX_COVERAGE = { from: "2026-08-24", to: "2026-10-20", tradingDays: 40 } as const;

export function formatCoverageDate(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const HKEX_COVERAGE_LABEL = `${formatCoverageDate(HKEX_COVERAGE.from)} – ${formatCoverageDate(HKEX_COVERAGE.to)}`;
