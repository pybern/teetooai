import type { Dataset } from "../types";

const years = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
const unemployment = [9.6, 8.9, 8.1, 7.4, 6.2, 5.3, 4.9, 4.4, 3.9, 3.7, 8.1, 5.3, 3.6, 3.6, 4.0];
const inflation = [1.6, 3.2, 2.1, 1.5, 1.6, 0.1, 1.3, 2.1, 2.4, 1.8, 1.2, 4.7, 8.0, 4.1, 2.9];
const fedFunds = [0.18, 0.1, 0.14, 0.11, 0.09, 0.13, 0.4, 1.0, 1.83, 2.16, 0.38, 0.08, 1.68, 5.02, 5.14];
const gdpGrowth = [2.7, 1.6, 2.3, 2.1, 2.5, 2.9, 1.8, 2.5, 3.0, 2.5, -2.2, 6.1, 2.5, 2.9, 2.8];

export const usMacro: Dataset = {
  id: "us-macro",
  name: "US Macro Indicators",
  description:
    "Annual averages of the headline US macroeconomic indicators: unemployment, CPI inflation, the effective federal funds rate, and real GDP growth.",
  kind: "timeseries",
  metrics: [
    {
      key: "unemployment",
      label: "Unemployment rate",
      short: "Unemployment",
      format: { suffix: "%", decimals: 1 },
      aliases: ["unemployment", "jobless", "jobs", "labor market", "labour market", "employment"],
      higherIsBetter: false,
    },
    {
      key: "inflation",
      label: "CPI inflation",
      short: "Inflation",
      format: { suffix: "%", decimals: 1 },
      aliases: ["inflation", "cpi", "prices", "cost of living", "price level"],
      higherIsBetter: false,
    },
    {
      key: "fedFunds",
      label: "Fed funds rate",
      short: "Fed funds",
      format: { suffix: "%", decimals: 2 },
      aliases: ["fed funds", "interest rate", "interest rates", "rates", "fed", "federal reserve", "policy rate", "monetary"],
    },
    {
      key: "gdpGrowth",
      label: "Real GDP growth",
      short: "GDP growth",
      format: { suffix: "%", decimals: 1 },
      aliases: ["gdp growth", "economic growth", "growth rate", "recession", "economy", "output", "real gdp"],
      higherIsBetter: true,
    },
  ],
  defaultMetric: "unemployment",
  rows: years.map((year, i) => ({
    year,
    unemployment: unemployment[i],
    inflation: inflation[i],
    fedFunds: fedFunds[i],
    gdpGrowth: gdpGrowth[i],
  })),
  keywords: ["us", "usa", "united states", "american", "macro", "economy", "fed", "bls", "recession", "covid", "pandemic"],
  source: {
    name: "US BLS (CPI, CPS), Federal Reserve H.15, BEA NIPA",
    url: "https://fred.stlouisfed.org/",
    note: "Annual averages; GDP growth is the annual real change as published by BEA.",
  },
  asOf: "2024",
};

const countries: {
  entity: string;
  region: string;
  gdp: number;
  population: number;
  aliases?: string[];
}[] = [
  { entity: "United States", region: "North America", gdp: 27.36, population: 334.9, aliases: ["usa", "u.s.", "america", "united states"] },
  { entity: "China", region: "Asia-Pacific", gdp: 17.79, population: 1410.7, aliases: ["prc"] },
  { entity: "Germany", region: "Europe", gdp: 4.46, population: 84.5 },
  { entity: "Japan", region: "Asia-Pacific", gdp: 4.21, population: 124.5 },
  { entity: "India", region: "Asia-Pacific", gdp: 3.55, population: 1428.6 },
  { entity: "United Kingdom", region: "Europe", gdp: 3.34, population: 68.3, aliases: ["uk", "britain", "england"] },
  { entity: "France", region: "Europe", gdp: 3.03, population: 68.2 },
  { entity: "Italy", region: "Europe", gdp: 2.25, population: 58.8 },
  { entity: "Brazil", region: "Latin America", gdp: 2.17, population: 216.4 },
  { entity: "Canada", region: "North America", gdp: 2.14, population: 40.1 },
  { entity: "Russia", region: "Europe", gdp: 2.02, population: 143.8 },
  { entity: "Mexico", region: "Latin America", gdp: 1.79, population: 128.5 },
  { entity: "Australia", region: "Asia-Pacific", gdp: 1.72, population: 26.6 },
  { entity: "South Korea", region: "Asia-Pacific", gdp: 1.71, population: 51.7, aliases: ["korea"] },
  { entity: "Spain", region: "Europe", gdp: 1.58, population: 48.4 },
  { entity: "Indonesia", region: "Asia-Pacific", gdp: 1.37, population: 277.5 },
  { entity: "Netherlands", region: "Europe", gdp: 1.12, population: 17.9, aliases: ["holland", "dutch"] },
  { entity: "Turkey", region: "Middle East", gdp: 1.11, population: 85.3, aliases: ["turkiye", "türkiye"] },
  { entity: "Saudi Arabia", region: "Middle East", gdp: 1.07, population: 36.9, aliases: ["saudi"] },
  { entity: "Switzerland", region: "Europe", gdp: 0.88, population: 8.8, aliases: ["swiss"] },
];

export const worldEconomy: Dataset = {
  id: "world-economy",
  name: "World's 20 Largest Economies",
  description:
    "Nominal GDP, population and GDP per capita for the 20 largest economies in 2023, grouped by region.",
  kind: "cross-section",
  entityLabel: "Country",
  entities: countries.map((c) => ({ name: c.entity, aliases: c.aliases })),
  groupAttrs: [{ key: "region", label: "Region", aliases: ["region", "continent", "regions", "regional"] }],
  metrics: [
    {
      key: "gdp",
      summable: true,
      label: "Nominal GDP",
      short: "GDP",
      format: { prefix: "$", suffix: "T", decimals: 2 },
      aliases: ["gdp", "economy", "economies", "output", "economic size", "largest economies", "biggest economies"],
      higherIsBetter: true,
    },
    {
      key: "population",
      summable: true,
      label: "Population",
      format: { suffix: "M", decimals: 1 },
      aliases: ["population", "people", "populous", "inhabitants", "demographic"],
    },
    {
      key: "gdpPerCapita",
      label: "GDP per capita",
      short: "Per capita",
      format: { prefix: "$", decimals: 0 },
      aliases: ["per capita", "per person", "income", "wealth", "richest", "living standard", "prosperity"],
      higherIsBetter: true,
    },
  ],
  defaultMetric: "gdp",
  rows: countries.map((c) => ({
    entity: c.entity,
    region: c.region,
    gdp: c.gdp,
    population: c.population,
    gdpPerCapita: Math.round((c.gdp * 1e12) / (c.population * 1e6)),
  })),
  keywords: ["country", "countries", "world", "global", "nations", "g20", "economies", "region"],
  source: {
    name: "World Bank — World Development Indicators",
    url: "https://data.worldbank.org/indicator/NY.GDP.MKTP.CD",
    note: "Current US dollars, 2023. Per-capita values derived from GDP ÷ population.",
  },
  asOf: "2023",
};
