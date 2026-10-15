import { DATASET_BY_ID } from "../data";
import type { Dataset, Intent, Interpretation } from "../types";

type Span = { start: number; end: number };
type Match = Span & { id: string; term: string };

export function normalize(q: string): string {
  return q
    .toLowerCase()
    .replace(/co₂/g, "co2")
    .replace(/[’']/g, "")
    .replace(/[?!,;:()"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

function findAll(text: string, term: string): Span[] {
  const re = new RegExp(`(^|[^a-z0-9])(${escape(term.toLowerCase())})(?=[^a-z0-9]|$)`, "g");
  const out: Span[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const start = m.index + m[1].length;
    out.push({ start, end: start + m[2].length });
    re.lastIndex = start + 1;
  }
  return out;
}

const overlaps = (a: Span, b: Span) => a.start < b.end && b.start < a.end;

/** Longest-match-wins allocation so "forward pe" beats "pe" and "china mobile" beats "china". */
function allocate(text: string, candidates: { id: string; terms: string[] }[], blocked: Span[] = []): Match[] {
  const all: Match[] = [];
  for (const c of candidates) {
    for (const term of c.terms) {
      for (const span of findAll(text, term)) all.push({ ...span, id: c.id, term });
    }
  }
  all.sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  const taken: Match[] = [];
  for (const m of all) {
    if (blocked.some((b) => b.start <= m.start && m.end <= b.end)) continue;
    if (taken.some((t) => overlaps(t, m))) continue;
    taken.push(m);
  }
  return taken.sort((a, b) => a.start - b.start);
}

function blank(text: string, spans: Span[]): string {
  let out = text;
  for (const sp of spans) out = out.slice(0, sp.start) + " ".repeat(sp.end - sp.start) + out.slice(sp.end);
  return out;
}

function uniqueIds(ms: Match[]): string[] {
  return [...new Set(ms.map((m) => m.id))];
}

export function entityMatches(text: string, ds: Dataset): Match[] {
  if (!ds.entities) return [];
  return allocate(
    text,
    ds.entities.map((e) => ({ id: e.name, terms: [e.name, ...(e.aliases ?? [])] })),
  );
}

export function metricMatches(text: string, ds: Dataset, entitySpans: Span[] = []): Match[] {
  return allocate(
    text,
    ds.metrics.map((m) => ({ id: m.key, terms: [m.label, ...(m.short ? [m.short] : []), ...m.aliases] })),
    entitySpans,
  );
}

function groupMatch(text: string, ds: Dataset): string | undefined {
  for (const g of ds.groupAttrs ?? []) {
    if (g.aliases.some((a) => findAll(text, a).length)) return g.key;
  }
  return undefined;
}

const has = (text: string, re: RegExp) => re.test(text);

const RE = {
  forecast: /\b(forecast|predict|prediction|project|projection|projected|outlook|extrapolat|will (it|they|.*) (be|reach|hit)|expected to)/,
  correlation: /\b(correlat\w*|relationship|related|relate|vs\.?|versus|against|impact of|affect\w*|link between|linked|association|associated|drive|driven)\b/,
  anomaly: /\b(anomal|outlier|unusual|spike|spiked|shock|crash|crashed|abnormal|surprise|extreme|jump|jumped)/,
  share: /\b(share of|breakdown|break down|broken down|mix|composition|split|proportion|distribution|makeup|make up|weighting|by sector|by region|by market(?! cap)|by source|by company|by country|pie)\b/,
  compare: /\b(compare|comparison|compared|vs\.?|versus|against|differ|difference|head to head|side by side)\b/,
  growth: /\b(grow|grew|growing|growth|fastest|cagr|compound|expand|expanded|expansion|increase|increased)\b/,
  rank: /\b(top|rank|ranking|ranked|largest|biggest|highest|lowest|most|least|best|worst|which|who|cheapest|leader|leaders|leading|smallest|richest|poorest|winners|losers|gainers|decliners|leaderboard)\b/,
  trend: /\b(trend|trends|trended|over time|history|historical|since|changed|change|evolve|evolved|evolution|trajectory|performed|perform|performance|how has|how did|how have|path|move|moved)\b/,
  asc: /\b(lowest|least|smallest|cheapest|worst|bottom|poorest|losers|decliners|weakest|fewest|lagg)/,
  bothEnds: /\b(winners and losers|gainers and losers|best and worst|top and bottom|gainers and decliners|highest and lowest)\b/,
};

function detectYears(text: string, ds: Dataset) {
  const years = ds.rows.map((r) => r.year).filter((y): y is number => typeof y === "number");
  const maxYear = years.length ? Math.floor(Math.max(...years)) : undefined;
  const minYear = years.length ? Math.floor(Math.min(...years)) : undefined;
  const found = [...text.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((m) => Number(m[1]));
  let yearFrom: number | undefined;
  let yearTo: number | undefined;
  let year: number | undefined;
  let targetYear: number | undefined;

  const future = maxYear !== undefined ? found.filter((y) => y > maxYear) : [];
  const past = maxYear !== undefined ? found.filter((y) => y <= maxYear) : found;
  if (future.length) targetYear = Math.max(...future);

  const lastN = text.match(/\b(?:last|past|previous|recent)\s+(\d+|few|five|three|ten|two)\s+(year|years|month|months)\b/);
  const words: Record<string, number> = { few: 3, two: 2, three: 3, five: 5, ten: 10 };
  if (lastN && maxYear !== undefined) {
    const n = Number(lastN[1]) || words[lastN[1]] || 3;
    const span = lastN[2].startsWith("month") ? n / 12 : n;
    const latest = Math.max(...years);
    yearFrom = Math.round((latest - span) * 10000) / 10000;
  }

  if (past.length >= 2) {
    yearFrom = Math.min(...past);
    yearTo = Math.max(...past);
  } else if (past.length === 1) {
    const y = past[0];
    if (has(text, new RegExp(`\\b(since|from|after|starting)\\s+${y}`))) yearFrom = y;
    else if (has(text, new RegExp(`\\b(until|through|before|up to|to)\\s+${y}`))) yearTo = y;
    else year = y;
  }

  return { yearFrom, yearTo, year, targetYear, minYear, maxYear };
}

function detectTopN(text: string): number | undefined {
  const m = text.match(/\b(?:top|bottom|first|largest|biggest|highest|lowest|smallest|cheapest|best|worst)\s+(\d{1,2})\b/) ?? text.match(/\b(\d{1,2})\s+(?:largest|biggest|highest|lowest|most|least|top|best|worst|cheapest|richest)\b/);
  if (m) return Math.max(1, Math.min(25, Number(m[1])));
  if (/\btop\b/.test(text)) return 5;
  return undefined;
}

type Scored = { ds: Dataset; score: number; signals: number };

export function scoreDataset(text: string, ds: Dataset): Scored {
  let score = 0;
  let signals = 0;
  for (const k of ds.keywords) {
    if (findAll(text, k).length) {
      score += 1 + 0.25 * (k.split(" ").length - 1);
      signals++;
    }
  }
  const ents = entityMatches(text, ds);
  const ids = uniqueIds(ents);
  score += 1.6 * ids.length;
  signals += ids.length;
  const mets = metricMatches(text, ds, ents);
  for (const m of mets) {
    score += 2 + 0.5 * (m.term.split(" ").length - 1);
    signals++;
  }
  if (groupMatch(text, ds)) {
    score += 1.5;
    signals++;
  }
  const isTime = ds.kind !== "cross-section";
  if (isTime && has(text, RE.forecast)) score += 0.6;
  if (isTime && has(text, RE.trend)) score += 0.3;
  if (!isTime && has(text, RE.share)) score += 0.3;
  if (ds.kind === "timeseries" && /\bby (region|market|country|sector|source|company)\b/.test(text)) score -= 2;
  if (ds.kind !== "timeseries" && has(text, RE.rank)) score += 0.2;
  if (has(text, RE.correlation) && mets.length >= 2) score += 1;
  return { ds, score, signals };
}

export function parseQuestion(question: string, datasetIds: string[]): Interpretation {
  const text = normalize(question);
  const scope = datasetIds.map((id) => DATASET_BY_ID[id]).filter(Boolean);
  const ranked = scope.map((ds) => scoreDataset(text, ds)).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const ds = best.ds;

  const ents = entityMatches(text, ds);
  const entities = uniqueIds(ents);
  const metricHits = metricMatches(text, ds, ents);
  let metrics = uniqueIds(metricHits);
  const intentText = blank(text, [...ents, ...metricHits.filter((m) => m.term.split(" ").length > 1 || /anomal|growth|performance|return/.test(m.term))]);
  const groupBy = groupMatch(text, ds);
  const { yearFrom, yearTo, year, targetYear } = detectYears(text, ds);
  let topN = detectTopN(text);
  const bothEnds = has(text, RE.bothEnds);
  if (bothEnds) topN = undefined;

  const isTime = ds.kind !== "cross-section";
  let intent: Intent;
  if (isTime && (has(intentText, RE.forecast) || targetYear !== undefined)) intent = "forecast";
  else if (isTime && has(intentText, RE.anomaly)) intent = "anomaly";
  else if (metrics.length >= 2 && has(intentText, RE.correlation) && entities.length < 2) intent = "correlation";
  else if (entities.length >= 2 && (has(intentText, RE.compare) || ds.kind !== "timeseries")) intent = "compare";
  else if ((has(intentText, RE.share) || groupBy) && ds.kind !== "timeseries") intent = "share";
  else if (ds.kind === "panel" && entities.length === 0 && has(intentText, RE.growth)) intent = "growth";
  else if (ds.kind === "cross-section" && entities.length === 1 && !has(intentText, RE.rank)) intent = "snapshot";
  else if (has(intentText, RE.rank) && !(ds.kind === "panel" && entities.length === 1) && !(ds.kind === "timeseries" && has(intentText, RE.trend) && !/\b(which|what) (year|month)\b/.test(intentText))) intent = "rank";
  else if (isTime) intent = ds.kind === "panel" && entities.length === 0 && !has(intentText, RE.trend) ? "rank" : "trend";
  else intent = entities.length === 1 ? "snapshot" : "rank";

  if (!metrics.length) metrics = [ds.defaultMetric];
  if (intent === "compare" && ds.kind === "cross-section") {
    metrics = [...metrics, ...ds.metrics.map((m) => m.key).filter((k) => !metrics.includes(k))];
  }
  if (intent === "snapshot") metrics = ds.metrics.map((m) => m.key);
  if (intent === "correlation" && metrics.length > 2) metrics = metrics.slice(0, 2);

  const order: "asc" | "desc" = !bothEnds && has(intentText, RE.asc) ? "asc" : "desc";

  const margin = ranked.length > 1 ? best.score - ranked[1].score : best.score;
  let confidence = best.score === 0 ? 0.42 : 0.6 + Math.min(0.25, best.signals * 0.06) + Math.min(0.12, margin * 0.03);
  confidence = Math.round(Math.min(0.98, confidence) * 100) / 100;

  return {
    question,
    datasetId: ds.id,
    datasetName: ds.name,
    intent,
    metrics,
    entities,
    groupBy,
    yearFrom,
    yearTo,
    year,
    targetYear,
    topN,
    order,
    confidence,
  };
}