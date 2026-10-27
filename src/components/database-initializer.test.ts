// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseInitializer } from "./database-initializer";

let root: Root;
let container: HTMLDivElement;
const onInitialize = vi.fn();
const target = { host: "saved.example.test", port: 6432, database: "insights" };
const result = {
  ok: true, ...target, durationMs: 1200,
  tables: [
    { name: "public.insightful_datasets", status: "created", insertedRows: 13 },
    { name: "public.insightful_hkex_short_selling", status: "skipped", insertedRows: 0 },
    { name: "public.insightful_configuration", status: "seeded", insertedRows: 1 },
  ],
  hkexCoverage: { records: 34077, from: "2026-08-24", to: "2026-10-20", currencies: ["CNY", "HKD", "USD"] },
};

async function render(unsavedChanges = false, configured = true) {
  await act(async () => {
    root.render(createElement(DatabaseInitializer, {
      target: configured ? target : { host: "", port: 5432, database: "" }, unsavedChanges, disabled: false, onInitialize,
    }));
  });
}
const button = () => container.querySelector("button")!;
async function confirm() {
  await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  onInitialize.mockReset().mockResolvedValue(result);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("explicit database initialization controls", () => {
  it("requires confirmation and displays the saved target, imported counts and skipped tables", async () => {
    expect(button().disabled).toBe(true);
    expect(container.textContent).toContain("insights at saved.example.test:6432");
    expect(onInitialize).not.toHaveBeenCalled();
    await confirm();
    expect(button().disabled).toBe(false);
    await act(async () => button().click());
    expect(onInitialize).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Initialization committed");
    expect(container.textContent).toContain("created and seeded 13 rows");
    expect(container.textContent).toContain("already exists, left untouched");
    expect(container.textContent).toContain("imported 1 missing settings rows");
    expect(container.textContent).toContain("34,077 records");
    expect(button().disabled).toBe(true);
  });
  it("blocks initialization while database edits are unsaved or no target is saved", async () => {
    await render(true);
    expect(container.textContent).toContain("Save your database changes");
    expect(container.querySelector<HTMLInputElement>("input")!.disabled).toBe(true);
    expect(button().disabled).toBe(true);
    await render(false, false);
    expect(container.textContent).toContain("Save a PostgreSQL connection");
    expect(button().disabled).toBe(true);
  });
  it("prevents double submission and reports failures without success-shaped output", async () => {
    let reject!: (reason: Error) => void;
    onInitialize.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    await confirm();
    await act(async () => { button().click(); button().click(); });
    expect(onInitialize).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Initializing database...");
    await act(async () => reject(new Error("Database permissions are insufficient. Initialization did not commit.")));
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("did not commit");
    expect(container.textContent).not.toContain("Initialization committed");
    expect(button().disabled).toBe(false);
  });
});
