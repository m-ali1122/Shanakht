import type { StepEvent } from "./types";

/**
 * POST a JSON body and consume a server-sent-event stream.
 * EventSource only supports GET, so we parse `data:` lines from fetch().
 */
export async function postSSE(
  url: string,
  body: unknown,
  onEvent: (e: StepEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`SSE ${url} failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      try {
        onEvent(JSON.parse(data) as StepEvent);
      } catch {
        /* ignore keep-alive / malformed lines */
      }
    }
  }
}

/** Replay a scripted event list with recorded timing (mock + offline mode). */
export async function replay(
  events: StepEvent[],
  onEvent: (e: StepEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const e of events) {
    if (signal?.aborted) return;
    const wait = Math.min(e.ms ?? 200, 1400);
    if (e.status !== "running") {
      await sleep(wait);
    } else {
      await sleep(60);
    }
    if (signal?.aborted) return;
    onEvent(e);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
