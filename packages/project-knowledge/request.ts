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

export interface RequestParts {
  scope: string | undefined;
  issue: number;
  row: StepRow;
  model: string | undefined;
  title: string | undefined;
}

export function buildRequest(p: RequestParts): KnowledgeRequest {
  const q = toQuery(p.title);
  // Spread in the upstream issue's order; a value that is not known is left out, not sent empty.
  return {
    contract: 1,
    ...(p.scope !== undefined ? { scope: p.scope } : {}),
    issue: p.issue,
    step: p.row.step,
    kinds: [...p.row.kinds],
    limit: p.row.lines,
    agent: "pi-rukas",
    ...(p.model !== undefined && p.model !== "" ? { model: p.model } : {}),
    ...(q !== undefined ? { q } : {}),
  };
}
