# Insightful — Text to Insight

Ask a question in plain English and get back a visual answer: a headline, KPI cards with sparklines, two to four charts, ranked findings, the underlying table, the equivalent SQL and an explanation of the method.

The "AI" is a mock. A deterministic engine parses the question and runs real statistics; no LLM is called. The data is real (see below).

## Features

- **Six use cases** with a persona, a scenario and curated questions:
  - HK Equities Analyst (the default)
  - Macro Economist
  - Climate Analyst
  - EV Market Strategist
  - Equity Research: Big Tech
  - Open Exploration
- **Nine analysis types:**
  - Trend
  - Ranking
  - Share or breakdown
  - Comparison (time series rebased to 100, or cross-sectional radar charts)
  - Correlation, including lead/lag detection
  - Forecast: linear, exponential or logistic, picked by R², with a 90% interval
  - Anomaly detection with z-scores and event annotations
  - Growth (CAGR)
  - Company snapshot
- **Chart types:** line, area, bar, horizontal bar, stacked bar, donut, composed (forecast band), scatter with regression line, radar, treemap and radial.
- **Workspace:**
  - Autocomplete in the ask bar
  - Suggestion chips and follow-up questions
  - An HKEX market strip
  - CSV export and shareable links (`/?uc=hk&q=...` runs the question automatically)
  - History kept in localStorage
- **Dashboard:** pin any answer to build a board.
- **Data catalog:** every dataset with its metrics, a preview chart, sample rows and its source.
- **API:** `POST /api/insight` with `{ "question": "...", "useCaseId": "hk" }`, or `GET /api/insight?q=...&uc=hk`.

## Data

| Dataset | Source |
| --- | --- |
| Hang Seng indices, 20 HK blue chips (prices, valuations, dividends, financials) | Yahoo Finance snapshot (`src/lib/data/hk-snapshot.json`) |
| US unemployment, CPI, fed funds, GDP growth 2010–2024 | BLS, BEA, Federal Reserve |
| GDP, population and GDP per capita of the 20 largest economies | World Bank (2023) |
| CO₂ concentration and temperature anomaly | NOAA, NASA GISS |
| Top CO₂ emitters | Global Carbon Project (2022) |
| Electricity mix, solar and wind share | Ember |
| Global and regional EV sales | IEA Global EV Outlook |
| Magnificent 7 revenue, net income and margin | 10-K filings, FY2021–24 |

### Refreshing the Hong Kong snapshot

```bash
npm run prefetch
```

This pulls five years of monthly prices, quotes, valuation ratios and annual financials from Yahoo Finance. Non-HKD financials are converted to HKD. The script then rewrites the snapshot JSON.

### HKEX daily short-selling extracts

[data/hkex/](./data/hkex/) contains standalone historical extracts from HKEX's
public Main Board and GEM daily quotation reports. These files are **not yet
connected to the application or data catalog**.

| File | Contents |
| --- | --- |
| [hkex-short-selling.csv](./data/hkex/hkex-short-selling.csv) | 34,077 records across 40 trading days, 24 August through 20 October 2026, covering both boards |
| [hkex-coverage.json](./data/hkex/hkex-coverage.json) | Requested twelve-month range, actual coverage, validation results and unavailable dates |
| [hkex-fetch-log.jsonl](./data/hkex/hkex-fetch-log.jsonl) | Per-request results, including retries; the latest entry for each board/date is authoritative |
| [hkex-short-selling-2026-10-20.csv](./data/hkex/hkex-short-selling-2026-10-20.csv) | Original validated one-day sample, also included in the combined extract |
| [hkex-access-validation.json](./data/hkex/hkex-access-validation.json) | Initial source-access checks, including separately labelled morning-report results |

Each CSV record contains the board, trading date, five-digit stock code, stock
name, short-selling shares and value, total traded shares and turnover, trading
currency, and source URL. Treat `stock_code` as text to retain leading zeros.
The unique record key is `(trading_date, stock_code)`. Monetary amounts are in
the row's trading currency; do not sum HKD, CNY and USD values together.

The collector reconciles each included report's security count, share totals
and monetary totals by currency. It requested 21 October 2025 through
20 October 2026: 80 reports validated, four explicitly reported public-holiday
closures, and 438 earlier weekday report URLs returned 404. A 404 does not
establish whether a date was a trading holiday or outside public retention.
Missing observations are not filled with zero.

The extracts include ETPs and other securities, not just ordinary shares, and
do not apply subsequent corrections. Technical access does not establish
commercial-use or redistribution rights; confirm the applicable HKEX terms
before such use.

The [collector](./scripts/hkex-backfill.py) requires Python 3.9+ and only uses
the standard library. Fetch a range into a new output directory:

```bash
python3 scripts/hkex-backfill.py \
  --start 2025-10-21 --end 2026-10-20 \
  --output data/hkex-refresh
```

Use `--resume` with the same range and output directory to reuse validated
reports, 404 responses and explicit holiday closures, and retry failures.
Only past dates are accepted so an unpublished or incomplete current-day
report cannot be mistaken for a completed report. The collector exits nonzero
for parsing, validation, network or unexpected HTTP failures; unavailable
404s and explicit closures are recorded in the coverage report.

## Development

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine tests (vitest)
npm run lint
npm run typecheck
npm run build
```

Built with Next.js 16 (App Router, Cache Components), React 19, Tailwind CSS v4, Recharts and lucide-react.

## Layout

```
src/lib/data/        datasets plus the HK snapshot
src/lib/engine/      parse.ts (question → interpretation), analyze.ts (→ report), stats.ts
src/lib/usecases.ts  personas and curated questions
src/components/      workspace, ask bar, report card, chart renderer, store
src/app/             workspace, /dashboard, /datasets, /api/insight
```
