import { checkRequestOrigin, ConnectionError } from "./connections";

export function createHkexRequestLimiter() {
  let active = 0;
  let started = 0;
  let windowStart = Date.now();
  return (request: Request): (() => void) => {
    checkRequestOrigin(request);
    if (request.headers.get("sec-fetch-site") === "cross-site") {
      throw new ConnectionError("Cross-site research requests are not allowed.", 403);
    }
    const now = Date.now();
    if (now - windowStart >= 60000) { windowStart = now; started = 0; }
    if (active >= 2 || started >= 10) {
      throw new ConnectionError("Database research is busy or has reached its shared request limit. Please try again in a minute.", 429);
    }
    active++;
    started++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
    };
  };
}

export const acquireHkexRequest = createHkexRequestLimiter();
