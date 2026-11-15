// Every shape shared by the project-knowledge package. The upstream issue is its specification.

/** Which issues get the block, by issue number (`PI_ENSEMBLE_KNOWLEDGE_ISSUES`). */
export type Arm = "all" | "even" | "odd";

/** The inputs, read from the environment of the run. */
export type Inputs =
  | { on: false; reason?: InputReason }
  | {
      on: true;
      url: string;
      /** Empty when unset: then no Authorization header is sent. */
      token: string;
      /** Undefined when unset: then no `scope` field is sent. */
      scope: string | undefined;
      arm: Arm;
      timeoutMs: number;
      /** `PI_ENSEMBLE_KNOWLEDGE_TITLE=0` turns the title off. */
      title: boolean;
      /** `PI_ENSEMBLE_KNOWLEDGE_ISSUE`, when a host sets it. */
      issue: number | undefined;
    };

/** A setting the polyfill cannot use. The session then makes no request. */
export type InputReason = "bad url" | "bad issues setting";

/** The steps of the upstream issue's table that ask for a block. */
export type Step = "explore" | "plan" | "develop" | "lens-review";

/** One row of the per-step table. */
export interface StepRow {
  step: Step;
  kinds: readonly string[];
  lines: number;
}

/** Where the issue number came from. */
export type IssueSource = "env" | "state" | "cwd";

/** What the polyfill found about its issue. `step` and `titleFile` come from the driver's state file. */
export type IssueFound =
  | {
      ok: true;
      issue: number;
      sources: IssueSource[];
      /** `pipelineState.currentStep` of the driver's state file, when one was matched. */
      step: string | undefined;
      /** The work-state directory, when one was found. The title is read under it. */
      stateDir: string | undefined;
    }
  | { ok: false; reason: "none" | "ambiguous" };

/** What issue.ts reads from the machine. Tests replace each one. */
export interface IssueSeams {
  env: NodeJS.ProcessEnv;
  cwd: string;
  ppid: number;
  /** The parent of a pid, or undefined. Used only when no state file names `ppid` itself. */
  parentOf: (pid: number) => number | undefined;
  /** The main repository's root from `git rev-parse --git-common-dir`, or undefined. */
  repoRoot: (cwd: string) => string | undefined;
}

/** The request body. Exactly the fields of the upstream issue. */
export interface KnowledgeRequest {
  contract: 1;
  scope?: string;
  issue: number;
  step: Step;
  kinds: string[];
  limit: number;
  agent: "pi-rukas";
  model?: string;
  q?: string;
}

/** One record as it reaches the block: checked, cleaned and cut. */
export interface KnowledgeRecord {
  id: string;
  statement: string;
}

/** Why a session got no block. A closed list, so a line never carries free text. */
export type FailReason = "timeout" | "status" | "too-large" | "bad-json" | "bad-contract" | "network";

/** The answer, checked. `offered` counts every entry of `records`, usable or not. */
export type Checked = { ok: true; records: KnowledgeRecord[]; offered: number } | { ok: false; reason: FailReason };

/** The rendered block plus the counts for the line. */
export interface Rendered {
  text: string;
  ids: string[];
  bytes: number;
  dropped: number;
}
