import { USE_CASE_BY_ID } from "../data";
import type { InsightReport } from "../types";
import { analyze } from "./analyze";
import { parseQuestion } from "./parse";

export function runInsight(question: string, useCaseId: string): InsightReport {
  const useCase = USE_CASE_BY_ID[useCaseId] ?? USE_CASE_BY_ID.explore;
  if (useCase.execution === "database-agent") throw new Error("HKEX database research requires the dedicated database agent, not the deterministic engine.");
  const interpretation = parseQuestion(question, useCase.datasetIds);
  return analyze(interpretation, useCase.id);
}

export { parseQuestion } from "./parse";
