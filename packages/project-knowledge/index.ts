// The project-knowledge pi extension. Once per session, on the first turn started by a prompt, it
// asks a project knowledge source for a few statements about the project and injects them as one
// message of hypotheses. It never throws, never holds a session past its time limit, and writes
// nothing but its one line on stderr.
import type { BeforeAgentStartEvent, BeforeAgentStartEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ask } from "./fetch.ts";
import { inArm, readInputs } from "./inputs.ts";
import { findIssue, parentOf, readTitle, repoRoot } from "./issue.ts";
import { checkAnswer, noBlockLine, renderBlock, servedLine } from "./render.ts";
import { buildRequest } from "./request.ts";
import { stepFor } from "./roles.ts";

const CUSTOM_TYPE = "project-knowledge";

/** What the extension reads from the machine. Tests replace each one. */
export interface Deps {
  env: () => NodeJS.ProcessEnv;
  fetch: typeof fetch;
  cwd: () => string;
  ppid: () => number;
  parentOf: (pid: number) => number | undefined;
  repoRoot: (cwd: string) => string | undefined;
  log: (line: string) => void;
}

const REAL: Deps = {
  env: () => process.env,
  fetch: (input, init) => fetch(input, init),
  cwd: () => process.cwd(),
  ppid: () => process.ppid,
  parentOf,
  repoRoot,
  log: (line) => console.error(line),
};

type Result = BeforeAgentStartEventResult | undefined;

async function once(d: Deps, ctx: Partial<ExtensionContext> | undefined, latch: () => void): Promise<Result> {
  const env = d.env();
  const inputs = readInputs(env);
  // No source set: the session is not a polyfilled one, so nothing is written.
  if (!inputs.on && inputs.reason === undefined) return undefined;

  // A role with no row asks nothing and writes nothing: the adversarial developer and ops.
  const role = env.PI_ENSEMBLE_ROLE;
  if (stepFor(role, undefined) === undefined) return undefined;

  // Set before anything can fail, so a session writes one line and asks once, not once per turn.
  latch();

  if (!inputs.on) {
    d.log(noBlockLine(inputs.reason ?? "off"));
    return undefined;
  }

  const cwd = typeof ctx?.cwd === "string" && ctx.cwd !== "" ? ctx.cwd : d.cwd();
  const found = findIssue(inputs.issue, { env, cwd, ppid: d.ppid(), parentOf: d.parentOf, repoRoot: d.repoRoot });
  if (!found.ok) {
    d.log(noBlockLine(`no issue: ${found.reason}`));
    return undefined;
  }
  if (!inArm(inputs.arm, found.issue)) {
    d.log(noBlockLine(`skipped: ${found.issue % 2 === 0 ? "even" : "odd"}`));
    return undefined;
  }

  const row = stepFor(role, found.step);
  if (row === undefined) return undefined;
  const body = buildRequest({
    scope: inputs.scope,
    issue: found.issue,
    row,
    model: ctx?.model?.id,
    title: inputs.title ? readTitle(found.stateDir, found.issue) : undefined,
  });

  const asked = await ask({ url: inputs.url, token: inputs.token, body, timeoutMs: inputs.timeoutMs, fetch: d.fetch });
  if (!asked.ok) {
    d.log(noBlockLine(asked.reason));
    return undefined;
  }
  const checked = checkAnswer(asked.status, asked.body);
  if (!checked.ok) {
    d.log(noBlockLine(checked.reason));
    return undefined;
  }

  const rendered = renderBlock(checked.records, row.lines, checked.offered);
  d.log(servedLine(found.issue, row.step, rendered));
  if (rendered.text === "") return undefined;
  return { message: { customType: CUSTOM_TYPE, content: rendered.text, display: true } };
}

export function createProjectKnowledge(over: Partial<Deps> = {}): (pi: ExtensionAPI) => void {
  const given: Deps = { ...REAL, ...over };
  // Writing the line must not be what throws.
  const log = (line: string): void => {
    try {
      given.log(line);
    } catch {
      // Nothing else to write to.
    }
  };
  const d: Deps = { ...given, log };
  return (pi: ExtensionAPI) => {
    let attempted = false;

    pi.on("session_start", () => {
      attempted = false;
    });

    pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext): Promise<Result> => {
      if (event.messageType !== "user" || attempted) return undefined;
      try {
        return await once(d, ctx, () => {
          attempted = true;
        });
      } catch {
        attempted = true;
        d.log(noBlockLine("internal"));
        return undefined;
      }
    });
  };
}

export default createProjectKnowledge();
