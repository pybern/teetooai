import type { Dataset } from "../types";
import { hkFinancials, hkIndices, hkPrices, hkValuations } from "./hk";
import { climateSignals, co2Emitters, electricityMix, renewablesGrowth } from "./climate";
import { usMacro, worldEconomy } from "./macro";
import { bigTech, evGlobal, evRegions } from "./markets";

export const DATASETS: Dataset[] = [
  hkIndices,
  hkValuations,
  hkPrices,
  hkFinancials,
  usMacro,
  worldEconomy,
  climateSignals,
  co2Emitters,
  electricityMix,
  renewablesGrowth,
  evGlobal,
  evRegions,
  bigTech,
];

export const DATASET_BY_ID: Record<string, Dataset> = Object.fromEntries(DATASETS.map((d) => [d.id, d]));

export { ALL_DATASET_IDS, USE_CASES, USE_CASE_BY_ID } from "../usecases";
