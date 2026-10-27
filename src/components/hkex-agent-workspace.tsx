"use client";

import type { UseCase } from "@/lib/types";
import { sendModelChat } from "@/lib/model-chat-stream";
import { ModelChat } from "./model-chat";

export function HkexAgentWorkspace({ uc, initialDraft = "" }: { uc: UseCase; initialDraft?: string }) {
  return (
    <div data-research-workspace className="mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-3 px-4 py-3 md:gap-4 md:px-10 md:py-4">
      <header className="shrink-0">
        <div className="meta text-slate-500">{uc.persona}</div>
        <h1 className="mt-2 text-xl font-semibold text-white md:text-3xl">{uc.name}</h1>
        <p className="mt-3 hidden text-sm leading-relaxed text-slate-400 sm:block">{uc.scenario}</p>
      </header>
      <ModelChat
        model="Server-configured research model" baseUrl=""
        disabled={false} unsavedChanges={false} agentMode initialDraft={initialDraft}
        suggestions={["Chart the top 10 HKD stocks by short-selling value on the latest stored day.", ...uc.questions.map((item) => item.q)]}
        onSend={(messages, signal, onText, onReasoning, onTools) => sendModelChat(undefined, messages, signal, onText, onReasoning, { api: "/api/hkex/chat", onTools })}
        onExplain={(explanationId, signal, onText, onReasoning) => sendModelChat(undefined, [], signal, onText, onReasoning, { api: "/api/hkex/chat", explanationId })}
      />
    </div>
  );
}
