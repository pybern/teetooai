// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Activity, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let root: Root;
let container: HTMLDivElement;
let style: HTMLStyleElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  style = document.createElement("style");
  const css = readFileSync(resolve("src/app/globals.css"), "utf8");
  style.textContent = css.match(/\.app-main:has\([^{}]+\{[^}]+\}/)![0];
  document.head.append(style);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  style.remove();
  vi.unstubAllGlobals();
});

describe("research workspace layout", () => {
  it.each([false, true])("releases page scrolling when a cached workspace is hidden (wrapper: %s)", async (wrapped) => {
    async function render(visible: boolean) {
      const workspace = <div data-research-workspace />;
      await act(async () => {
        root.render(
          <main className="app-main">
            <Activity mode={visible ? "visible" : "hidden"}>
              {wrapped ? <div>{workspace}</div> : workspace}
            </Activity>
            <Activity mode={visible ? "hidden" : "visible"}>
              <div>Configuration</div>
            </Activity>
          </main>,
        );
      });
    }

    await render(true);
    const main = container.querySelector("main")!;
    expect(getComputedStyle(main).overflow).toBe("hidden");
    expect(getComputedStyle(main).height).toBe("100dvh");

    await render(false);
    expect(main.querySelector("[data-research-workspace]")).not.toBeNull();
    expect(getComputedStyle(main).overflow).not.toBe("hidden");
    expect(getComputedStyle(main).height).not.toBe("100dvh");

    await render(true);
    expect(getComputedStyle(main).overflow).toBe("hidden");
    expect(getComputedStyle(main).height).toBe("100dvh");
  });
});
