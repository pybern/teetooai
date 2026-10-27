import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminTokenGenerator, generateAdminToken } from "./admin-token-generator";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("administrator token generator", () => {
  it("generates 64 lowercase hex characters with 32 cryptographically random bytes", () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(bytes.length).toBe(32);
      bytes.forEach((_, index) => { bytes[index] = index; });
      return bytes;
    });
    vi.stubGlobal("crypto", { getRandomValues });
    expect(generateAdminToken()).toBe("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f");
    expect(getRandomValues).toHaveBeenCalledOnce();
  });
  it("generates distinct valid secrets using real Web Crypto", () => {
    const first = generateAdminToken();
    const second = generateAdminToken();
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });
  it("fails explicitly without a secure random source instead of falling back", () => {
    vi.stubGlobal("crypto", undefined);
    expect(generateAdminToken).toThrow("Secure random generation is unavailable");
  });
  it("does not generate a secret at render time and uses non-submit buttons", () => {
    const getRandomValues = vi.fn();
    vi.stubGlobal("crypto", { getRandomValues });
    const html = renderToStaticMarkup(createElement(AdminTokenGenerator));
    expect(getRandomValues).not.toHaveBeenCalled();
    expect(html).toContain('type="button"');
    expect(html).toContain("Generate secure token");
    expect(html).not.toContain("<input");
    expect(html).toContain("Environment Variables");
    expect(html).toContain("does not change your current server token");
  });
});
