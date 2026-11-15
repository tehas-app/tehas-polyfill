// The inputs of the upstream issue. All optional, all read from the environment of the run.
import type { Arm, Inputs } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 3000;
const MAX_TIMEOUT_MS = 8000;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * `https://` anywhere, `http://` on loopback only, so a test can run a server and a real source is
 * never reached in the clear. A user or password in the URL is refused: the token has its own input.
 */
function goodUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hostname === "" || url.username !== "" || url.password !== "") return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK.has(url.hostname);
}

function timeoutOf(raw: string | undefined): number {
  if (raw === undefined || !/^\d+$/.test(raw)) return DEFAULT_TIMEOUT_MS;
  const n = Number(raw);
  if (n < 1) return DEFAULT_TIMEOUT_MS;
  return Math.min(n, MAX_TIMEOUT_MS);
}

function issueOf(raw: string | undefined): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

export function readInputs(env: NodeJS.ProcessEnv): Inputs {
  const url = env.PI_ENSEMBLE_KNOWLEDGE_URL ?? "";
  if (url === "" || env.PI_ENSEMBLE_KNOWLEDGE === "0") return { on: false };
  if (!goodUrl(url)) return { on: false, reason: "bad url" };

  // A trial's arm is never guessed: a value this polyfill does not know makes no request.
  const armRaw = env.PI_ENSEMBLE_KNOWLEDGE_ISSUES ?? "all";
  if (armRaw !== "all" && armRaw !== "even" && armRaw !== "odd") return { on: false, reason: "bad issues setting" };

  const scope = env.PI_ENSEMBLE_KNOWLEDGE_SCOPE;
  return {
    on: true,
    url,
    token: env.PI_ENSEMBLE_KNOWLEDGE_TOKEN ?? "",
    scope: scope === undefined || scope === "" ? undefined : scope,
    arm: armRaw,
    timeoutMs: timeoutOf(env.PI_ENSEMBLE_KNOWLEDGE_TIMEOUT_MS),
    title: env.PI_ENSEMBLE_KNOWLEDGE_TITLE !== "0",
    issue: issueOf(env.PI_ENSEMBLE_KNOWLEDGE_ISSUE),
  };
}

/** Whether an issue is in the arm that gets the block. */
export function inArm(arm: Arm, issue: number): boolean {
  if (arm === "all") return true;
  return (issue % 2 === 0) === (arm === "even");
}
