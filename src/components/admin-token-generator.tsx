"use client";

import { useState } from "react";

export function generateAdminToken(): string {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure random generation is unavailable. Use HTTPS or localhost, or run openssl rand -hex 32 locally.");
  }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function AdminTokenGenerator() {
  const [token, setToken] = useState("");
  const [visible, setVisible] = useState(false);
  const [copying, setCopying] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const buttonClass = "min-h-10 border border-slate-600 px-3 text-sm text-slate-200 transition hover:border-sky-400 hover:text-white disabled:opacity-50";

  function generate() {
    setToken("");
    setVisible(false);
    try {
      setToken(generateAdminToken());
      setNotice({ error: false, text: "Generated a 256-bit secret. Copy it and configure it on your server before using it to unlock settings." });
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error ? error.message : "Could not generate a secure token." });
    }
  }

  async function copy() {
    setCopying(true);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard access is unavailable. Show the token and copy it manually. Automatic copying requires HTTPS or localhost.");
      await navigator.clipboard.writeText(token);
      setNotice({ error: false, text: "Token copied. Paste it as the CONFIG_ADMIN_TOKEN environment variable value." });
    } catch (error) {
      setNotice({ error: true, text: error instanceof Error && error.message.startsWith("Clipboard access")
        ? error.message : "Could not copy the token. Allow clipboard access, or show the token and copy it manually." });
    } finally { setCopying(false); }
  }

  return (
    <section aria-labelledby="token-generator-title" className="mt-6 border-t border-slate-700 pt-5">
      <h3 id="token-generator-title" className="text-sm font-semibold text-white">Need an administrator token?</h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">
        Generate a secure 64-character token here. It stays in this page&apos;s memory and is not sent to the server or saved in browser storage.
        This is not a Vercel AI Gateway API key.
      </p>
      <button type="button" className={`${buttonClass} mt-4`} onClick={generate} disabled={copying}>
        {token ? "Generate new token" : "Generate secure token"}
      </button>
      {token && (
        <div className="mt-4">
          <label className="block text-sm text-slate-300">
            Generated administrator token
            <input
              className="mt-2 w-full min-w-0 border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white"
              type={visible ? "text" : "password"}
              value={token}
              readOnly
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="none"
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-3">
            <button type="button" className={buttonClass} onClick={copy} disabled={copying}>{copying ? "Copying..." : "Copy token"}</button>
            <button type="button" className={buttonClass} aria-pressed={visible} onClick={() => setVisible((current) => !current)}>{visible ? "Hide token" : "Show token"}</button>
          </div>
        </div>
      )}
      <div aria-live="polite" aria-atomic="true">
        {notice && <p className={`mt-3 text-xs leading-relaxed ${notice.error ? "text-rose-300" : "text-emerald-300"}`}>{notice.text}</p>}
      </div>
      <ol className="mt-4 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-slate-400">
        <li>In Vercel, open your project&apos;s Settings &gt; Environment Variables.</li>
        <li>Add <code>CONFIG_ADMIN_TOKEN</code>, paste the generated token as its value, and select the deployment environments that need it.</li>
        <li>Save and redeploy. Then enter the same token in the administrator field above.</li>
      </ol>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Locally, set the same variable in <code>.env.local</code> and restart the server.
        Generating a new token does not change your current server token. Keep a secure copy before leaving this page.
      </p>
    </section>
  );
}
