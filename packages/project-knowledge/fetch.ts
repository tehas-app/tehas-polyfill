// The one request. One try, a time limit that holds even when the network does not: an
// AbortSignal on the fetch, and a timer that races the whole exchange, headers and body.
import { MAX_ANSWER_BYTES } from "./render.ts";
import type { FailReason, KnowledgeRequest } from "./types.ts";

export type Asked = { ok: true; status: number; body: string } | { ok: false; reason: FailReason };

export interface Ask {
  url: string;
  token: string;
  body: KnowledgeRequest;
  timeoutMs: number;
  fetch: typeof fetch;
}

class TooLarge extends Error {}

/** The body as text, read up to the cap. A body over it is refused without reading the rest. */
async function capped(res: Response): Promise<string> {
  const length = Number(res.headers.get("content-length") ?? "");
  if (Number.isFinite(length) && length > MAX_ANSWER_BYTES) throw new TooLarge();
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_ANSWER_BYTES) {
      void reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function exchange(a: Ask, signal: AbortSignal): Promise<Asked> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  if (a.token !== "") headers.authorization = `Bearer ${a.token}`;
  try {
    // A redirect is not followed, so the token never goes to a second address.
    const res = await a.fetch(a.url, { method: "POST", headers, body: JSON.stringify(a.body), signal, redirect: "manual" });
    if (res.status !== 200) {
      void res.body?.cancel().catch(() => {});
      return { ok: false, reason: "status" };
    }
    return { ok: true, status: res.status, body: await capped(res) };
  } catch (error) {
    if (error instanceof TooLarge) return { ok: false, reason: "too-large" };
    if (signal.aborted) return { ok: false, reason: "timeout" };
    // The error's own text may hold the URL; only its kind is reported.
    return { ok: false, reason: "network" };
  }
}

export async function ask(a: Ask): Promise<Asked> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Asked>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, reason: "timeout" });
    }, a.timeoutMs);
  });
  try {
    return await Promise.race([exchange(a, controller.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}
