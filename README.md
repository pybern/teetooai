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
