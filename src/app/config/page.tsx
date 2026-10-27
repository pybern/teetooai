import type { Metadata } from "next";
import { ConnectionSettings } from "@/components/connection-settings";

export const metadata: Metadata = { title: "Configuration - Insightful" };

export default function ConfigPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-24 pt-6 md:px-8">
      <header className="mb-8 border-b border-slate-700 pb-6">
        <div className="meta text-slate-500">Workspace / Configuration</div>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">Connections</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
          Configure your model endpoint and PostgreSQL database. Test actual responses before saving.
          These settings do not replace the workspace&apos;s deterministic analysis engine.
        </p>
      </header>
      <ConnectionSettings />
    </div>
  );
}
