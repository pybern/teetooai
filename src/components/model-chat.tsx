"use client";

import { memo, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { HkexChart } from "./hkex-chart";
import { SqlChart } from "./sql-chart";
import { ResearchInsightSummary } from "./insight-summary";
import { PdfExportButton } from "./pdf-export-button";
import { researchErrorMessage } from "@/lib/model-chat-stream";
import {
  MAX_CHAT_MESSAGES, MAX_CHAT_MESSAGE_CHARS, MAX_CHAT_TOTAL_CHARS,
  type ModelChatMessage, type ModelChatResult, type ModelChatToolActivity,
} from "@/lib/connections";

type Props = {
  model: string;
  baseUrl: string;
  unsavedChanges: boolean;
  disabled: boolean;
  agentMode?: boolean;
  /** Agent-mode header label and PDF export title. */
  agentLabel?: string;
  exportTitle?: string;
  emptyPrompt?: string;
  initialDraft?: string;
  suggestions?: string[];
  onExplain?: (id: string, signal: AbortSignal, onText: (text: string) => void, onReasoning: (text: string) => void) => Promise<ModelChatResult>;
  onSend: (messages: ModelChatMessage[], signal: AbortSignal, onText: (text: string) => void, onReasoning: (reasoning: string) => void, onTools: (tools: ModelChatToolActivity[]) => void) => Promise<ModelChatResult>;
};

type ChatFailure = { message: string; details?: string };

function researchFailure(error: unknown): ChatFailure {
  return {
    message: researchErrorMessage(error),
    details: error instanceof Error ? error.message : typeof error === "string" ? error : undefined,
  };
}

function ChatError({ error }: { error: ChatFailure }) {
  return <div className="mt-3 min-w-0 shrink-0 text-sm text-rose-300">
    <p role="alert">{error.message}</p>
    {error.details && <details className="mt-2 border border-slate-700 px-3 py-2 text-xs text-slate-300">
      <summary className="cursor-pointer py-1">Error details</summary>
      <pre className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap font-mono [overflow-wrap:anywhere]">{error.details}</pre>
    </details>}
  </div>;
}

function ToolActivities({ tools, active = false }: { tools: ModelChatToolActivity[]; active?: boolean }) {
  const running = active && tools.some((item) => item.status === "running");
  return (
    <details className="my-3 border border-slate-700 px-3 py-2 text-xs text-slate-400">
      <summary className="cursor-pointer py-1"><span className={cn(running && "research-shimmer")}>Research tools ({tools.length}){running ? " - running" : ""}</span></summary>
      <ol className="mt-2 space-y-3">
        {tools.map((item) => (
          <li key={item.id}>
            <p className={cn(item.status === "error" && "text-rose-300")}><span className={cn(active && item.status === "running" && "research-shimmer")}><strong>{item.tool}</strong> - {item.status}: {item.summary}</span></p>
            {item.sql && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono">{item.sql}</pre>}
            {item.parameters && <p className="mt-1 break-words font-mono">Parameters: {JSON.stringify(item.parameters)}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function SqlPreview({ tools }: { tools: ModelChatToolActivity[] }) {
  const queries = tools.filter((item) => item.sql);
  if (!queries.length) return null;
  return <details data-pdf-exclude className="my-3 border border-slate-700 px-3 py-2 text-xs text-slate-300">
    <summary className="cursor-pointer py-1">View SQL</summary>
    <ol className="mt-2 flex flex-col gap-4">
      {queries.map((item) => <li key={item.id}>
        <p className="font-semibold">{item.summary}</p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono">{item.sql}</pre>
        {item.parameters && <p className="mt-1 break-words font-mono">Parameters: {JSON.stringify(item.parameters)}</p>}
      </li>)}
    </ol>
  </details>;
}

function ResearchCharts({ tools }: { tools: ModelChatToolActivity[] }) {
  return tools.filter((item) => item.status === "complete" && item.chart).map((item) => item.chart && <HkexChart key={item.id} spec={item.chart} />);
}

function SqlCharts({ tools }: { tools: ModelChatToolActivity[] }) {
  return tools.filter((item) => item.status === "complete" && item.sqlChart).map((item) => item.sqlChart && <SqlChart key={item.id} spec={item.sqlChart} />);
}

const CHART_STEPS = new Set(["chooseChart", "renderChart"]);
const PLACEHOLDER_BARS = [55, 80, 40, 95, 65, 30, 70];

/** Holds the chart's place below the answer while a chart is still being chosen or built. */
function ChartPlaceholder({ tools }: { tools: ModelChatToolActivity[] }) {
  if (!tools.some((item) => item.status === "running" && CHART_STEPS.has(item.tool))) return null;
  return (
    <figure data-chart-placeholder aria-busy="true" aria-label="Chart loading" className="my-4 min-w-0 border border-slate-700 p-3 md:p-4">
      <figcaption className="text-sm text-slate-400"><span className="research-shimmer">Preparing chart...</span></figcaption>
      <div aria-hidden="true" className="mt-3 flex h-72 items-end gap-2">
        {PLACEHOLDER_BARS.map((height, index) => <div key={index} className="shimmer flex-1 rounded-sm" style={{ height: `${height}%` }} />)}
      </div>
    </figure>
  );
}

function ResearchInsights({ tools }: { tools: ModelChatToolActivity[] }) {
  return tools.filter((item) => item.status === "complete" && item.insights).map((item) => item.insights && <ResearchInsightSummary key={item.id} summary={item.insights} />);
}

const markdownComponents: Components = {
  a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>,
  img: ({ alt }) => <span className="text-slate-400">[Image: {alt || "No description"}]</span>,
  table: ({ children }) => <div className="my-3 overflow-x-auto"><table>{children}</table></div>,
};
const markdownPlugins = [remarkGfm];

const MarkdownReply = memo(function MarkdownReply({ text, muted = false }: { text: string; muted?: boolean }) {
  return (
    <div className={`mt-2 min-w-0 break-words leading-relaxed ${muted ? "text-xs text-slate-400" : "text-sm text-slate-200"} [&_p]:my-2 [&_p]:whitespace-pre-wrap [&_h1]:my-3 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:my-3 [&_h3]:font-semibold [&_h4]:my-2 [&_h4]:font-semibold [&_h5]:my-2 [&_h5]:font-semibold [&_h6]:my-2 [&_h6]:font-semibold [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1 [&_a]:text-sky-300 [&_a]:underline [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-500 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 [&_code]:rounded [&_code]:bg-slate-900 [&_code]:px-1 [&_code]:font-mono [&_code]:text-xs [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-slate-900 [&_pre]:p-3 [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-slate-600 [&_th]:px-3 [&_th]:py-2 [&_td]:border [&_td]:border-slate-700 [&_td]:px-3 [&_td]:py-2 [&_hr]:my-4 [&_hr]:border-slate-700`}>
      <ReactMarkdown remarkPlugins={markdownPlugins} components={markdownComponents}>{text}</ReactMarkdown>
    </div>
  );
});

function ThinkingBlock({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    if (expanded && following.current && content.current) {
      content.current.scrollTop = content.current.scrollHeight;
    }
  }, [text, expanded]);
  return (
    <div data-pdf-thinking={text} className={`my-3 flex min-w-0 flex-col overflow-hidden border-l-2 border-slate-600 bg-slate-900/60 px-3 py-3 ${expanded ? "h-56" : ""}`}>
      <button type="button" aria-label={expanded ? "Collapse thinking" : "Expand thinking"} aria-expanded={expanded} aria-controls={id} onClick={() => { following.current = true; setExpanded((value) => !value); }} className="flex min-h-10 w-full shrink-0 items-center justify-between gap-3 text-slate-400 hover:text-white">
        <span className={cn("meta", streaming && "research-shimmer")}>{streaming ? "Thinking..." : "Thinking"}</span>
        <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <div
        ref={content} id={id} role="region" aria-label="Thinking process" tabIndex={0} hidden={!expanded}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-sky-400"
        onScroll={(event) => {
          const panel = event.currentTarget;
          following.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 24;
        }}
      >
        {expanded && <MarkdownReply text={text} muted />}
      </div>
    </div>
  );
}

function ExplainResults({ id, onExplain, disabled }: { id: string; onExplain: NonNullable<Props["onExplain"]>; disabled: boolean }) {
  const [text, setText] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [error, setError] = useState<ChatFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  useEffect(() => {
    const log = panel.current?.closest('[role="log"]');
    if (log) log.scrollTop = log.scrollHeight;
  }, [text, reasoning, error, busy]);
  async function explain() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setText(""); setReasoning(""); setError(null);
    try {
      const result = await onExplain(id, controller.signal,
        (value) => { if (!controller.signal.aborted) setText(value); },
        (value) => { if (!controller.signal.aborted) setReasoning(value); });
      if (!controller.signal.aborted) {
        setText(result.message.content);
        if (result.reasoning) setReasoning(result.reasoning);
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(researchFailure(error));
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }
  return <div ref={panel} data-pdf-busy={busy} className="mt-3 border-t border-slate-700 pt-3">
    {(!text || error) && !busy && <button type="button" disabled={disabled} onClick={explain} className="min-h-10 border border-slate-600 px-3 text-sm text-sky-300 disabled:opacity-50">Explain these results</button>}
    {busy && <><p role="status" className="text-sm text-slate-400"><span className="research-shimmer">Preparing your explanation...</span></p><button type="button" className="min-h-10 text-sm text-sky-300" onClick={() => { active.current?.abort(); active.current = null; setBusy(false); setText(""); setReasoning(""); setError({ message: "Explanation cancelled." }); }}>Cancel explanation</button></>}
    {reasoning && <ThinkingBlock text={reasoning} streaming={busy} />}
    {text && <><p className="meta mt-3 text-slate-400">{error ? "Incomplete explanation" : "Explanation"}</p><MarkdownReply text={text} /></>}
    {error && <ChatError error={error} />}
  </div>;
}

type ConversationMessage = ModelChatMessage & { reasoning?: string; tools?: ModelChatToolActivity[] };

const ChatMessage = memo(function ChatMessage({ message, agentMode, onExplain, disabled }: {
  message: ConversationMessage;
  agentMode: boolean;
  onExplain: Props["onExplain"];
  disabled: boolean;
}) {
  const explanationId = message.tools?.find((item) => item.explanationId)?.explanationId;
  return (
    <article className={`border-b border-slate-700 px-3 py-4 last:border-b-0 ${message.role === "user" ? "bg-slate-900" : ""}`}>
      <div className="meta text-slate-500">{message.role === "user" ? "You" : agentMode ? "Answer" : "Model"}</div>
      {message.role === "assistant" && message.reasoning && <ThinkingBlock text={message.reasoning} />}
      {message.tools && <ToolActivities tools={message.tools} />}
      {agentMode && message.tools && <ResearchInsights tools={message.tools} />}
      {message.role === "assistant" ? <MarkdownReply text={message.content} /> : (
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-200">{message.content}</p>
      )}
      {agentMode && message.tools && <ResearchCharts tools={message.tools} />}
      {agentMode && message.tools && <SqlCharts tools={message.tools} />}
      {agentMode && message.tools && <SqlPreview tools={message.tools} />}
      {agentMode && onExplain && message.role === "assistant" && explanationId && <ExplainResults id={explanationId} onExplain={onExplain} disabled={disabled} />}
    </article>
  );
});

export function ModelChat({
  model, baseUrl, unsavedChanges, disabled, onSend, onExplain, agentMode = false, initialDraft = "", suggestions = [],
  agentLabel = "HKEX short selling", exportTitle = "HKEX Short-Selling Research",
  emptyPrompt = "Compare stocks, explore short-selling trends or start with a question below.",
}: Props) {
  const inputId = useId();
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState(initialDraft);
  const [pending, setPending] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingReasoning, setStreamingReasoning] = useState("");
  const [streamingTools, setStreamingTools] = useState<ModelChatToolActivity[]>([]);
  const [error, setError] = useState<ChatFailure | null>(null);
  const [incomplete, setIncomplete] = useState<{ prompt: string; text: string; reasoning: string; tools: ModelChatToolActivity[] } | null>(null);
  const [lastResult, setLastResult] = useState<ModelChatResult | null>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const full = messages.length + 1 > MAX_CHAT_MESSAGES ||
    messages.reduce((total, message) => total + message.content.length, 0) + draft.trim().length > MAX_CHAT_TOTAL_CHARS;
  const buttonClass = "min-h-10 border border-slate-600 px-4 text-sm text-slate-200 transition hover:border-sky-400 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

  useEffect(() => () => { activeRequest.current?.abort(); }, []);
  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [messages, pending, streamingText, streamingReasoning, streamingTools, incomplete]);

  function cancel() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setPending("");
    setStreamingText("");
    setStreamingReasoning("");
    setStreamingTools([]);
    setError({ message: "Request cancelled. Your message is still available to edit or resend." });
  }

  function clear() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setMessages([]);
    setIncomplete(null);
    setPending("");
    setStreamingText("");
    setStreamingReasoning("");
    setStreamingTools([]);
    setDraft("");
    setError(null);
    setLastResult(null);
    input.current?.focus();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || activeRequest.current || disabled || full) return;
    const user: ModelChatMessage = { role: "user", content: draft.trim() };
    const controller = new AbortController();
    activeRequest.current = controller;
    setPending(user.content);
    setStreamingText("");
    setStreamingReasoning("");
    setStreamingTools([]);
    setError(null);
    setIncomplete(null);
    const partial = { prompt: user.content, text: "", reasoning: "", tools: [] as ModelChatToolActivity[] };
    try {
      const context = [...messages, user].map(({ role, content }) => ({ role, content }));
      const result = await onSend(context, controller.signal, (text) => {
        if (!controller.signal.aborted) { partial.text = text; setStreamingText(text); }
      }, (reasoning) => {
        if (!controller.signal.aborted) { partial.reasoning = reasoning; setStreamingReasoning(reasoning); }
      }, (tools) => {
        if (!controller.signal.aborted) { partial.tools = tools; setStreamingTools(tools); }
      });
      if (controller.signal.aborted) return;
      if (result.message?.role !== "assistant" || !result.message.content?.trim()) {
        throw new Error("The model returned no assistant feedback.");
      }
      setMessages((current) => [...current, user, { ...result.message, reasoning: result.reasoning, tools: result.tools }]);
      setLastResult(result);
      setDraft("");
    } catch (error) {
      if (!controller.signal.aborted) {
        if (agentMode && (partial.text || partial.reasoning || partial.tools.length)) {
          setIncomplete({
            ...partial,
            tools: partial.tools.map((item) => item.status === "running" ? { ...item, status: "error", summary: "Interrupted before completion; no result was confirmed." } : item),
          });
        }
        setError(agentMode ? researchFailure(error) : { message: error instanceof Error ? error.message : "The model request failed. Your message has been kept for retry." });
      }
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setPending("");
        setStreamingText("");
        setStreamingReasoning("");
        setStreamingTools([]);
        input.current?.focus();
      }
    }
  }

  return (
    <section aria-labelledby={`${inputId}-title`} className={`flex flex-col overflow-hidden border border-slate-700 bg-slate-950 ${agentMode ? "min-h-0 flex-1 p-3 md:p-5" : "h-[52rem] p-5 md:p-6"}`}>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="meta text-slate-500">{agentMode ? agentLabel : "Live model playground"}</div>
          <h2 id={`${inputId}-title`} className="mt-2 text-xl font-semibold text-white">{agentMode ? "Ask a question" : "Chat with your saved model"}</h2>
          {!agentMode && <p className="mt-2 break-words font-mono text-xs text-slate-300">{lastResult?.model ?? model}</p>}
          {!agentMode && (lastResult?.baseUrl ?? baseUrl) && <p className="mt-1 break-all text-xs text-slate-500">{lastResult?.baseUrl ?? baseUrl}</p>}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {agentMode && <PdfExportButton target={log} title={exportTitle} disabled={!!pending || (!messages.length && !incomplete)} />}
          <button type="button" className={buttonClass} onClick={clear}>New chat</button>
        </div>
      </div>
      {!agentMode && <p className="mt-4 shrink-0 text-xs leading-relaxed text-slate-400">
        Save your API settings before chatting.{" "}
        Requests use only the server&apos;s saved endpoint, key and model,
        never unsaved form values. Saving API settings starts a new chat.
        Messages stay in page memory and are sent to your provider with conversation context.
        Provider charges may apply. Replies can take up to 60 seconds.
      </p>}
      {!agentMode && unsavedChanges && <p className="mt-3 shrink-0 text-xs text-amber-400">You have unsaved API changes. This chat still uses the previously saved settings.</p>}
      <div ref={log} role="log" tabIndex={0} aria-label={agentMode ? "Research conversation" : "Model test conversation"} aria-live="polite" aria-relevant="additions" className={`${agentMode ? "mt-3" : "mt-5"} min-h-0 flex-1 overflow-y-auto overscroll-contain border-y border-slate-700`}>
        {!messages.length && !pending && !incomplete && (
          <div className="px-1 py-8 text-sm text-slate-500">
            <p>{agentMode ? emptyPrompt : "Send a message to see a real reply from your saved model."}</p>
            {suggestions.length > 0 && <div className="mt-4 flex flex-wrap gap-2">
              {suggestions.map((question) => <button key={question} type="button" className="border border-slate-700 px-3 py-2 text-left text-xs text-slate-300 hover:border-sky-400" disabled={disabled} onClick={() => { setDraft(question); input.current?.focus(); }}>{question}</button>)}
            </div>}
          </div>
        )}
        {messages.map((message, index) => (
          <ChatMessage key={index} message={message} agentMode={agentMode} onExplain={onExplain} disabled={disabled || !!pending} />
        ))}
        {incomplete && (
          <article className="border-b border-amber-400/40 px-3 py-4">
            <p className="meta text-amber-400">Incomplete research</p>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-300">{incomplete.prompt}</p>
            <p className="mt-2 text-xs text-slate-400">We couldn&apos;t finish this answer. The results below may be incomplete. You can send your question again.</p>
            {incomplete.reasoning && <ThinkingBlock text={incomplete.reasoning} />}
            {incomplete.tools.length > 0 && <ToolActivities tools={incomplete.tools} />}
            {agentMode && <ResearchInsights tools={incomplete.tools} />}
            {incomplete.text && <MarkdownReply text={incomplete.text} />}
            {agentMode && <ResearchCharts tools={incomplete.tools} />}
            {agentMode && <SqlCharts tools={incomplete.tools} />}
            {agentMode && <SqlPreview tools={incomplete.tools} />}
          </article>
        )}
        {pending && (
          <div className="px-3 py-4">
            <div className="meta text-slate-500">You</div>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-200">{pending}</p>
            {streamingReasoning && <ThinkingBlock text={streamingReasoning} streaming={!streamingText} />}
            {streamingTools.length > 0 && <ToolActivities tools={streamingTools} active />}
            {agentMode && <SqlPreview tools={streamingTools} />}
            {agentMode && <ResearchInsights tools={streamingTools} />}
            {streamingText && (
              <div className="mt-4">
                <div className="meta text-slate-500">{agentMode ? "Answer" : "Model"}</div>
                <MarkdownReply text={streamingText} />
              </div>
            )}
            {agentMode && <ResearchCharts tools={streamingTools} />}
            {agentMode && <SqlCharts tools={streamingTools} />}
            {agentMode && <ChartPlaceholder tools={streamingTools} />}
            <p role="status" className="mt-4 text-xs text-sky-300"><span className="research-shimmer">{agentMode ? "Researching your question..." : streamingText ? "Receiving model reply..." : streamingReasoning ? "Receiving model thinking..." : streamingTools.length ? "Running database research..." : "Waiting for model feedback..."}</span></p>
          </div>
        )}
      </div>
      {!agentMode && lastResult && <p className="mt-2 text-xs text-slate-500">Last reply: {lastResult.durationMs} ms</p>}
      {error && <ChatError error={error} />}
      {full && <p role="status" className="mt-3 text-xs text-amber-400">{agentMode ? "Start a new chat to keep exploring." : "Conversation limit reached. Choose New chat or shorten your message."}</p>}
      <form onSubmit={send} className={`${agentMode ? "mt-3" : "mt-5"} shrink-0`}>
        <label htmlFor={inputId} className="text-sm text-slate-300">{agentMode ? "Your question" : "Message to saved model"}</label>
        <textarea
          id={inputId}
          ref={input}
          className={`mt-2 max-h-40 w-full resize-y border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white placeholder:text-slate-500 disabled:opacity-50 ${agentMode ? "min-h-16" : "min-h-24"}`}
          rows={agentMode ? 2 : 3}
          maxLength={MAX_CHAT_MESSAGE_CHARS}
          required
          value={draft}
          disabled={!!pending || disabled}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={agentMode ? "What would you like to know?" : "Ask your model a question..."}
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="submit" className={`${buttonClass} border-sky-500 text-sky-300`} disabled={!draft.trim() || !!pending || disabled || full}>Send message</button>
          {pending && <button type="button" className={buttonClass} onClick={cancel}>Cancel request</button>}
          {!agentMode && <span className="text-xs text-slate-500">{Math.floor(messages.length / 2)} completed turns / 11 maximum</span>}
        </div>
      </form>
    </section>
  );
}
