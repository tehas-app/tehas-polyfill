// The request body: exactly the fields of the upstream issue, and nothing of the issue but its
// title as search words.
import type { KnowledgeRequest, StepRow } from "./types.ts";

const MAX_QUERY = 200;
const NOT_A_WORD = /[^\p{L}\p{N}]+/u;

/**
 * The title as search words: letters and digits only, lower case, one space between, at most 200
 * characters. A pasted address or key in a title does not go out whole. No word is cut in half,
 * unless the first word alone is longer than the cap.
 */
export function toQuery(title: string | undefined): string | undefined {
  if (title === undefined) return undefined;
  const words = title.split(NOT_A_WORD).filter((w) => w !== "").map((w) => w.toLowerCase());
  let q = "";
  for (const w of words) {
    const next = q === "" ? w : `${q} ${w}`;
    if (Array.from(next).length > MAX_QUERY) {
      if (q === "") q = Array.from(w).slice(0, MAX_QUERY).join("");
      break;
    }
    q = next;
  }
  return q === "" ? undefined : q;
}

const MAX_MODEL = 64;

/**
 * The session's model id in the form a source takes: `^[a-z0-9][a-z0-9.-]{0,62}[a-z0-9]$`. Lower
 * case, any other character a dash, repeated dashes one, no dash or dot at either end, at most 64
 * characters. An id with less than two characters left is left out, as a source refuses it.
 */
export function toModel(model: string | undefined): string | undefined {
  if (model === undefined) return undefined;
  const trim = (s: string) => s.replace(/^[.-]+|[.-]+$/g, "");
  const dashed = model.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/-{2,}/g, "-");
  const m = trim(trim(dashed).slice(0, MAX_MODEL));
  return m.length < 2 ? undefined : m;
}

export interface RequestParts {
  scope: string | undefined;
  issue: number;
  row: StepRow;
  model: string | undefined;
  title: string | undefined;
}

export function buildRequest(p: RequestParts): KnowledgeRequest {
  const q = toQuery(p.title);
  const model = toModel(p.model);
  // Spread in the upstream issue's order; a value that is not known is left out, not sent empty.
  return {
    contract: 1,
    ...(p.scope !== undefined ? { scope: p.scope } : {}),
    issue: p.issue,
    step: p.row.step,
    kinds: [...p.row.kinds],
    limit: p.row.lines,
    agent: "pi-rukas",
    ...(model !== undefined ? { model } : {}),
    ...(q !== undefined ? { q } : {}),
  };
}
