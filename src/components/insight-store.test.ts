// @vitest-environment jsdom

import { act, createElement, Suspense } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInsight } from "@/lib/engine";
import { InsightStoreProvider, useInsights } from "./insight-store";
import { Sidebar } from "./sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("./theme", () => ({ ThemeToggle: () => null }));

const report = runInsight("Top 10 Hong Kong stocks by market cap", "explore");
const saved = {
  entries: [{
    id: "saved-query", question: "Saved market research", useCaseId: "hk",
    status: "done", startedAt: 1, report,
  }],
  pinned: [report, { ...report, id: "second-pin" }, { ...report, id: "third-pin" }],
};

let root: Root | undefined;

function Status() {
  const { hydrated, pinned, entries, togglePin, clear, isPinned } = useInsights();
  return createElement("section", null,
    createElement("output", { id: "status" }, `${hydrated}:${pinned.length}:${entries.length}:${isPinned(report.id)}`),
    createElement("button", { id: "unpin", onClick: () => togglePin(report) }, "Unpin report"),
    createElement("button", { id: "clear", onClick: clear }, "Clear history"),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("insightful:v1", JSON.stringify(saved));
});

afterEach(async () => {
  if (root) await act(async () => { root?.unmount(); });
  root = undefined;
  localStorage.clear();
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("insight store hydration", () => {
  it("keeps a delayed sidebar's first hydration snapshot consistent with its server HTML", async () => {
    let blocked = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    function DeferredSidebar() {
      if (blocked) throw pending;
      return createElement(Sidebar);
    }
    const tree = createElement(InsightStoreProvider, null,
      createElement(Status),
      createElement(Suspense, { fallback: null }, createElement(DeferredSidebar)),
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    const badge = () => container.querySelector('nav a[href="/dashboard"]')?.textContent;
    expect(badge()).toBe("Dashboard0");
    expect(container.textContent).not.toContain("Saved market research");

    blocked = true;
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (error) => { errors.push(error); } });
    });
    expect(container.querySelector("#status")?.textContent).toBe("true:3:1:true");
    expect(badge()).toBe("Dashboard0");

    await act(async () => { blocked = false; release(); });
    expect(badge()).toBe("Dashboard3");
    expect(container.textContent).toContain("Saved market research");
    expect(errors).toEqual([]);
    expect(JSON.parse(localStorage.getItem("insightful:v1")!).pinned).toHaveLength(3);
  });

  it("restores data after normal hydration and preserves pin and history actions", async () => {
    const tree = createElement(InsightStoreProvider, null, createElement(Status));
    const container = document.createElement("div");
    container.innerHTML = renderToString(tree);
    document.body.append(container);
    expect(container.querySelector("#status")?.textContent).toBe("false:0:0:false");
    const errors: unknown[] = [];
    await act(async () => {
      root = hydrateRoot(container, tree, { onRecoverableError: (error) => { errors.push(error); } });
    });
    expect(container.querySelector("#status")?.textContent).toBe("true:3:1:true");
    await act(async () => { container.querySelector<HTMLButtonElement>("#unpin")!.click(); });
    expect(container.querySelector("#status")?.textContent).toBe("true:2:1:false");
    await act(async () => { container.querySelector<HTMLButtonElement>("#clear")!.click(); });
    expect(container.querySelector("#status")?.textContent).toBe("true:2:0:false");
    expect(JSON.parse(localStorage.getItem("insightful:v1")!)).toMatchObject({ entries: [], pinned: expect.any(Array) });
    expect(errors).toEqual([]);
  });
});
