"use client";

import type { ReactNode } from "react";
import type { UseCase } from "@/lib/types";
import { sendModelChat } from "@/lib/model-chat-stream";
import { ModelChat } from "./model-chat";

const HKEX_EXTRA_SUGGESTION = "Chart the top 10 HKD stocks by short-selling value on the latest stored day.";

export function HkexAgentWorkspace({ uc, initialDraft = "", children }: { uc: UseCase; initialDraft?: string; children?: ReactNode }) {
  const hkex = uc.id === "hkex-db";
  return (
    <div data-research-workspace className="flex min-h-0 w-full flex-1 flex-col">
      <ModelChat
        model="Server-configured research model" baseUrl=""
        disabled={false} unsavedChanges={false} agentMode initialDraft={initialDraft}
        agentLabel={uc.name}
        {...(hkex ? {} : { exportTitle: `${uc.name} Research`, emptyPrompt: "Ask about any of this workspace's data, or start with a question below." })}
        intro={
          <div className="space-y-6">
            <div>
              <div className="meta text-slate-500">{uc.persona}</div>
              <h1 className="mt-2 text-2xl font-semibold tracking-tight text-white md:text-3xl">{uc.name}</h1>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">{uc.scenario}</p>
            </div>
            {children && <div className="hidden md:block">{children}</div>}
          </div>
        }
        suggestions={hkex ? [HKEX_EXTRA_SUGGESTION, ...uc.questions.map((item) => item.q)] : uc.questions.map((item) => item.q)}
        onSend={(messages, signal, onText, onReasoning, onTools) => sendModelChat(undefined, messages, signal, onText, onReasoning, { api: "/api/hkex/chat", onTools, useCaseId: uc.id })}
        onExplain={(explanationId, signal, onText, onReasoning) => sendModelChat(undefined, [], signal, onText, onReasoning, { api: "/api/hkex/chat", explanationId })}
      />
    </div>
  );
}
