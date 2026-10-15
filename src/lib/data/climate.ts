import type { Dataset } from "../types";

const climateYears = Array.from({ length: 25 }, (_, i) => 2000 + i);
const co2ppm = [
  369.7, 371.3, 373.5, 375.8, 377.5, 379.8, 381.9, 383.8, 385.6, 387.4, 389.9, 391.6, 393.9, 396.5, 398.6, 400.8,
  404.2, 406.5, 408.7, 411.7, 414.2, 416.4, 418.5, 421.1, 424.6,
];
const tempAnomaly = [
  0.4, 0.54, 0.63, 0.62, 0.53, 0.68, 0.64, 0.66, 0.54, 0.65, 0.72, 0.61, 0.65, 0.68, 0.75, 0.9, 1.01, 0.92, 0.85,
  0.98, 1.01, 0.85, 0.89, 1.17, 1.28,
];

export const climateSignals: Dataset = {
  id: "climate-signals",
  name: "Global Climate Signals",
  description:
    "Annual mean atmospheric CO₂ concentration measured at Mauna Loa and the global surface temperature anomaly versus the 1951–1980 baseline.",
  kind: "timeseries",
  metrics: [
    {
      key: "co2ppm",
      label: "CO₂ concentration",
      short: "CO₂ ppm",
      format: { suffix: " ppm", decimals: 1 },
      aliases: ["co2 concentration", "concentration", "ppm", "atmospheric", "mauna loa", "carbon dioxide", "co2 level", "co2 levels", "co2"],
      higherIsBetter: false,
    },
    {
      key: "tempAnomaly",
      label: "Temperature anomaly",
      short: "Temp anomaly",
      format: { prefix: "+", suffix: "°C", decimals: 2 },
      aliases: ["temperature", "temperatures", "warming", "anomaly", "heat", "hottest", "warmest", "global warming"],
      higherIsBetter: false,
    },
  ],
  defaultMetric: "tempAnomaly",
  rows: climateYears.map((year, i) => ({ year, co2ppm: co2ppm[i], tempAnomaly: tempAnomaly[i] })),
  keywords: ["climate", "warming", "temperature", "atmosphere", "nasa", "noaa", "global"],
  source: {
    name: "NOAA GML (Mauna Loa CO₂) & NASA GISTEMP v4",
    url: "https://gml.noaa.gov/ccgg/trends/",
    note: "Annual means. Temperature anomaly relative to 1951–1980 average.",
  },
  asOf: "2024",
};

const emitters: { entity: string; total: number; perCapita: number; aliases?: string[] }[] = [
  { entity: "China", total: 11.4, perCapita: 8.0 },
  { entity: "United States", total: 5.06, perCapita: 14.9, aliases: ["usa", "u.s.", "america", "united states"] },
  { entity: "India", total: 2.83, perCapita: 2.0 },
  { entity: "Russia", total: 1.65, perCapita: 11.4 },
  { entity: "Japan", total: 1.05, perCapita: 8.5 },
  { entity: "Iran", total: 0.75, perCapita: 8.5 },
  { entity: "Indonesia", total: 0.73, perCapita: 2.6 },
  { entity: "Saudi Arabia", total: 0.69, perCapita: 18.2, aliases: ["saudi"] },
  { entity: "Germany", total: 0.67, perCapita: 8.0 },
  { entity: "South Korea", total: 0.6, perCapita: 11.6, aliases: ["korea"] },
  { entity: "Canada", total: 0.55, perCapita: 14.2 },
  { entity: "Mexico", total: 0.49, perCapita: 3.8 },
  { entity: "Brazil", total: 0.48, perCapita: 2.2 },
  { entity: "Turkey", total: 0.45, perCapita: 5.1, aliases: ["turkiye"] },
  { entity: "South Africa", total: 0.4, perCapita: 6.7 },
  { entity: "Australia", total: 0.39, perCapita: 14.9 },
  { entity: "United Kingdom", total: 0.34, perCapita: 4.7, aliases: ["uk", "britain"] },
  { entity: "Italy", total: 0.32, perCapita: 5.4 },
  { entity: "Poland", total: 0.32, perCapita: 8.1 },
  { entity: "France", total: 0.3, perCapita: 4.6 },
];

export const co2Emitters: Dataset = {
  id: "co2-emitters",
  name: "Top 20 CO₂ Emitters",
  description:
    "Fossil CO₂ emissions by country in 2022 — total (gigatonnes) and per person (tonnes) — for the 20 largest emitters.",
  kind: "cross-section",
  entityLabel: "Country",
  entities: emitters.map((e) => ({ name: e.entity, aliases: e.aliases })),
  metrics: [
    {
      key: "total",
      summable: true,
      label: "Total CO₂ emissions",
      short: "Emissions",
      format: { suffix: " Gt", decimals: 2 },
      aliases: ["emissions", "emitters", "emitter", "polluters", "pollute", "carbon emissions", "co2 emissions", "gigatonnes", "total emissions"],
      higherIsBetter: false,
    },
    {
      key: "perCapita",
      label: "CO₂ per capita",
      short: "Per capita",
      format: { suffix: " t", decimals: 1 },
      aliases: ["per capita", "per person", "per head", "footprint"],
      higherIsBetter: false,
    },
  ],
  defaultMetric: "total",
  rows: emitters.map((e) => ({ entity: e.entity, total: e.total, perCapita: e.perCapita })),
  keywords: ["emissions", "emitters", "polluters", "country", "countries", "carbon", "fossil"],
  source: {
    name: "Global Carbon Project — Global Carbon Budget 2023",
    url: "https://globalcarbonbudget.org/",
    note: "Fossil CO₂ incl. cement, 2022, rounded. Covers ~80% of global emissions.",
  },
  asOf: "2022",
};

const mix: { entity: string; share: number; category: string; aliases?: string[] }[] = [
  { entity: "Coal", share: 35.4, category: "Fossil" },
  { entity: "Gas", share: 22.5, category: "Fossil", aliases: ["natural gas"] },
  { entity: "Hydro", share: 14.3, category: "Clean", aliases: ["hydropower", "hydroelectric"] },
  { entity: "Nuclear", share: 9.1, category: "Clean" },
  { entity: "Wind", share: 7.8, category: "Clean" },
  { entity: "Solar", share: 5.5, category: "Clean", aliases: ["pv", "photovoltaic"] },
  { entity: "Other fossil", share: 2.7, category: "Fossil", aliases: ["oil"] },
  { entity: "Bioenergy", share: 2.4, category: "Clean", aliases: ["biomass"] },
  { entity: "Other renewables", share: 0.3, category: "Clean", aliases: ["geothermal"] },
];

export const electricityMix: Dataset = {
  id: "electricity-mix",
  name: "Global Electricity Mix 2023",
  description: "Share of global electricity generation by source in 2023, tagged as fossil or clean.",
  kind: "cross-section",
  entityLabel: "Source",
  entities: mix.map((m) => ({ name: m.entity, aliases: m.aliases })),
  groupAttrs: [{ key: "category", label: "Category", aliases: ["fossil vs clean", "clean vs fossil", "category", "fossil", "clean energy", "low-carbon", "low carbon"] }],
  metrics: [
    {
      key: "share",
      summable: true,
      label: "Share of generation",
      short: "Share",
      format: { suffix: "%", decimals: 1 },
      aliases: ["share", "mix", "electricity", "generation", "power", "grid", "sources", "energy mix", "breakdown"],
    },
  ],
  defaultMetric: "share",
  rows: mix.map((m) => ({ entity: m.entity, share: m.share, category: m.category })),
  keywords: ["electricity", "power", "grid", "mix", "generation", "coal", "nuclear", "hydro", "sources", "energy"],
  source: {
    name: "Ember — Global Electricity Review 2024",
    url: "https://ember-energy.org/latest-insights/global-electricity-review-2024/",
  },
  asOf: "2023",
};

const renewYears = Array.from({ length: 10 }, (_, i) => 2015 + i);
const solarShare = [1.1, 1.4, 1.8, 2.2, 2.7, 3.3, 3.7, 4.5, 5.5, 6.9];
const windShare = [3.5, 3.9, 4.4, 4.8, 5.3, 5.9, 6.6, 7.3, 7.8, 8.1];

export const renewablesGrowth: Dataset = {
  id: "renewables-growth",
  name: "Solar & Wind Share of Global Power",
  description: "Share of global electricity generated by solar and wind, 2015–2024.",
  kind: "panel",
  entityLabel: "Source",
  entities: [
    { name: "Solar", aliases: ["pv", "photovoltaic"] },
    { name: "Wind", aliases: ["turbines"] },
  ],
  metrics: [
    {
      key: "share",
      label: "Share of generation",
      short: "Share",
      format: { suffix: "%", decimals: 1 },
      aliases: ["share", "renewables", "renewable", "solar", "wind", "clean power", "generation"],
      higherIsBetter: true,
      ceiling: 100,
    },
  ],
  defaultMetric: "share",
  rows: renewYears.flatMap((year, i) => [
    { entity: "Solar", year, share: solarShare[i] },
    { entity: "Wind", year, share: windShare[i] },
  ]),
  keywords: ["renewable", "renewables", "solar", "wind", "clean", "transition", "growth", "energy"],
  source: {
    name: "Ember — Yearly Electricity Data",
    url: "https://ember-energy.org/data/yearly-electricity-data/",
  },
  asOf: "2024",
};
