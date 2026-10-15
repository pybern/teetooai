import { runInsight } from "@/lib/engine";
import { USE_CASE_BY_ID } from "@/lib/usecases";

const MAX_QUESTION = 300;

function validate(question: unknown, useCaseId: unknown): { question: string; useCaseId: string } | string {
  if (typeof question !== "string" || !question.trim()) return "`question` must be a non-empty string";
  if (question.length > MAX_QUESTION) return `\`question\` must be at most ${MAX_QUESTION} characters`;
  const uc = typeof useCaseId === "string" && USE_CASE_BY_ID[useCaseId] ? useCaseId : "explore";
  return { question: question.trim(), useCaseId: uc };
}

function respond(question: unknown, useCaseId: unknown) {
  const input = validate(question, useCaseId);
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });
  try {
    return Response.json({ report: runInsight(input.question, input.useCaseId) });
  } catch (err) {
    console.error("Insight generation failed", { question: input.question, err });
    return Response.json({ error: "Could not generate an insight for that question. Try rephrasing it." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: { question?: unknown; useCaseId?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  return respond(body.question, body.useCaseId);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return respond(url.searchParams.get("q"), url.searchParams.get("uc"));
}
