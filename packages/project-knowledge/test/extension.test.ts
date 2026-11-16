// The extension's own tests: index.ts driven through a fake pi, with a fetch that records what it
// was asked and answers what the test says. The loopback server tests are in integration.test.ts.
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { createProjectKnowledge, type Deps } from "../index.ts";
import { cleanup, goodAnswer, scratch, TITLE, TOKEN, URL_OK, writeState } from "./helpers.ts";

const ROOT = scratch("ext");
afterAll(() => cleanup(ROOT));
const ME = 4242;

/** pi's extension host, as little of it as the polyfill touches. */
class FakePi {
  private readonly handlers = new Map<string, ((event: unknown, ctx: unknown) => unknown)[]>();

  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): () => void {
    const list = this.handlers.get(event) ?? [];
    list.push(handler);
    this.handlers.set(event, list);
    return () => {};
  }

  async fire(event: string, payload: Record<string, unknown>, ctx: Record<string, unknown> = {}): Promise<unknown> {
    let last: unknown;
    for (const h of this.handlers.get(event) ?? []) {
      const got = await h({ type: event, systemPrompt: "", systemPromptOptions: {}, ...payload }, ctx);
      if (got !== undefined) last = got;
    }
    return last;
  }
}

interface Call {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

interface Harness {
  pi: FakePi;
  calls: Call[];
  lines: string[];
  turn: (ctx?: Record<string, unknown>) => Promise<{ message?: { customType: string; content: string; display: boolean } } | undefined>;
  newSession: () => Promise<unknown>;
}

function harness(env: NodeJS.ProcessEnv, answer: () => Promise<Response> | Response, over: Partial<Deps> = {}): Harness {
  const calls: Call[] = [];
  const lines: string[] = [];
  const pi = new FakePi();
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    return answer();
  }) as typeof fetch;
  createProjectKnowledge({
    env: () => env,
    fetch: fakeFetch,
    cwd: () => "/repo",
    ppid: () => ME,
    parentOf: () => undefined,
    repoRoot: () => undefined,
    log: (line) => lines.push(line),
    ...over,
  })(pi as never);
  return {
    pi,
    calls,
    lines,
    turn: (ctx = { model: { provider: "fleet", id: "example-model-1" } }) =>
      pi.fire("before_agent_start", { messageType: "user", prompt: "do the issue" }, ctx) as never,
    newSession: () => pi.fire("session_start", { reason: "new" }),
  };
}

function ok(body = goodAnswer(2)): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

function repoWithState(issue: number, step = "develop"): string {
  const root = join(ROOT, `r-${issue}-${step}-${Math.random().toString(36).slice(2, 8)}`);
  writeState(root, { issue, ownerPid: ME, step, title: TITLE, body: "body text" });
  return root;
}

function env(over: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    PI_ENSEMBLE_KNOWLEDGE_URL: URL_OK,
    PI_ENSEMBLE_KNOWLEDGE_TOKEN: TOKEN,
    PI_ENSEMBLE_KNOWLEDGE_SCOPE: "r_7k2m",
    PI_ENSEMBLE_ROLE: "developer",
    PI_ENSEMBLE_KNOWLEDGE_ISSUE: "412",
    ...over,
  };
}

describe("off", () => {
  test("no URL: no request, no line, no message (upstream test 1)", async () => {
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_URL: undefined }), ok);
    expect(await h.turn()).toBeUndefined();
    expect(h.calls).toHaveLength(0);
    expect(h.lines).toEqual([]);
  });

  test("the switch at 0: the same (upstream test 2)", async () => {
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE: "0" }), ok);
    expect(await h.turn()).toBeUndefined();
    expect(h.calls).toHaveLength(0);
    expect(h.lines).toEqual([]);
  });

  test("a bad URL: no request, one line", async () => {
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_URL: "http://knowledge.example/x" }), ok);
    expect(await h.turn()).toBeUndefined();
    expect(await h.turn()).toBeUndefined();
    expect(h.calls).toHaveLength(0);
    expect(h.lines).toEqual(["project-knowledge polyfill: no block (bad url)"]);
  });

  test("a bad arm setting: no request, one line", async () => {
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_ISSUES: "both" }), ok);
    await h.turn();
    expect(h.calls).toHaveLength(0);
    expect(h.lines).toEqual(["project-knowledge polyfill: no block (bad issues setting)"]);
  });
});

describe("roles (upstream test 7)", () => {
  for (const role of ["adversarial-developer", "ops", undefined, "unknown-role"]) {
    test(`${role ?? "no role"}: no request and no line`, async () => {
      const h = harness(env({ PI_ENSEMBLE_ROLE: role }), ok);
      expect(await h.turn()).toBeUndefined();
      expect(h.calls).toHaveLength(0);
      expect(h.lines).toEqual([]);
    });
  }

  test("an explore child in the plan step asks the plan's kinds and limit", async () => {
    const root = repoWithState(412, "plan");
    const h = harness(env({ PI_ENSEMBLE_ROLE: "explore", PI_ENSEMBLE_WORKSPACE_ROOT: root }), ok);
    await h.turn();
    expect(h.calls[0]?.body.step).toBe("plan");
    expect(h.calls[0]?.body.limit).toBe(10);
    expect(h.calls[0]?.body.kinds).toEqual(["decision", "convention", "ticket-adjustment", "failure-pattern"]);
  });

  test("a reviewer asks lens-review", async () => {
    const h = harness(env({ PI_ENSEMBLE_ROLE: "code-review-specialist" }), ok);
    await h.turn();
    expect(h.calls[0]?.body.step).toBe("lens-review");
  });
});

describe("a good answer (upstream test 4)", () => {
  test("gives one message and one line", async () => {
    const h = harness(env(), ok);
    const got = await h.turn();
    expect(got?.message?.customType).toBe("project-knowledge");
    expect(got?.message?.display).toBe(true);
    expect(got?.message?.content).toContain("- [pk:R1] [unverified] Statement number 1.");
    expect(got?.message?.content).toContain("- [pk:R2] [unverified] Statement number 2.");
    expect(h.lines).toHaveLength(1);
    expect(h.lines[0]).toMatch(/^project-knowledge polyfill: issue 412, step develop, 2 records, \d+ bytes, 0 dropped, ids R1,R2$/);
  });

  test("an answer with no usable record: the line and no message", async () => {
    const h = harness(env(), () => ok(JSON.stringify({ contract: 1, records: [{ id: "bad id", statement: "x" }] })));
    expect(await h.turn()).toBeUndefined();
    expect(h.lines).toEqual(["project-knowledge polyfill: issue 412, step develop, 0 records, 0 bytes, 1 dropped, ids none"]);
  });

  test("the request is a POST of JSON with the session's model", async () => {
    const h = harness(env(), ok);
    await h.turn();
    const c = h.calls[0];
    expect(c?.url).toBe(URL_OK);
    expect(c?.init.method).toBe("POST");
    expect(new Headers(c?.init.headers).get("content-type")).toBe("application/json");
    expect(c?.body.model).toBe("example-model-1");
    expect(c?.body.scope).toBe("r_7k2m");
    expect(c?.body.issue).toBe(412);
  });

  test("no model in the session: no model field", async () => {
    const h = harness(env(), ok);
    await h.turn({});
    expect("model" in (h.calls[0]?.body ?? {})).toBe(false);
  });

  test("the title from the driver's file is sent as q; PI_ENSEMBLE_KNOWLEDGE_TITLE=0 leaves it out", async () => {
    const root = repoWithState(412);
    const on = harness(env({ PI_ENSEMBLE_WORKSPACE_ROOT: root }), ok);
    await on.turn();
    expect(on.calls[0]?.body.q).toBe("add a subtract function to calc qx7 mark title 9");
    const off = harness(env({ PI_ENSEMBLE_WORKSPACE_ROOT: root, PI_ENSEMBLE_KNOWLEDGE_TITLE: "0" }), ok);
    await off.turn();
    expect("q" in (off.calls[0]?.body ?? {})).toBe(false);
  });
});

describe("the token (upstream test 6)", () => {
  test("is in the Authorization header and in no line, message or body", async () => {
    const h = harness(env(), ok);
    const got = await h.turn();
    expect(new Headers(h.calls[0]?.init.headers).get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(JSON.stringify(h.calls[0]?.body)).not.toContain(TOKEN);
    expect(JSON.stringify(got)).not.toContain(TOKEN);
    expect(h.lines.join("\n")).not.toContain(TOKEN);
    expect(h.lines.join("\n")).not.toContain(URL_OK);
  });

  test("is in no line when the fetch throws with it in the message", async () => {
    const h = harness(env(), () => {
      throw new Error(`connect failed for ${URL_OK} with Bearer ${TOKEN}`);
    });
    expect(await h.turn()).toBeUndefined();
    expect(h.lines).toEqual(["project-knowledge polyfill: no block (network)"]);
  });

  test("no token: no Authorization header", async () => {
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_TOKEN: undefined }), ok);
    await h.turn();
    expect(new Headers(h.calls[0]?.init.headers).has("authorization")).toBe(false);
  });
});

describe("the arm (upstream test 3)", () => {
  const cases: [string, string, boolean, string | null][] = [
    ["even", "412", true, null],
    ["even", "413", false, "skipped: odd"],
    ["odd", "412", false, "skipped: even"],
    ["odd", "413", true, null],
  ];
  for (const [arm, issue, asks, reason] of cases) {
    test(`${arm}, issue ${issue}: ${asks ? "asks" : "no request"}`, async () => {
      const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_ISSUES: arm, PI_ENSEMBLE_KNOWLEDGE_ISSUE: issue }), ok);
      await h.turn();
      expect(h.calls).toHaveLength(asks ? 1 : 0);
      if (reason !== null) expect(h.lines).toEqual([`project-knowledge polyfill: no block (${reason})`]);
    });
  }
});

describe("the issue", () => {
  test("none found: one line, no request", async () => {
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_ISSUE: undefined }), ok);
    await h.turn();
    expect(h.calls).toHaveLength(0);
    expect(h.lines).toEqual(["project-knowledge polyfill: no block (no issue: none)"]);
  });

  test("two sources that disagree: ambiguous, no request", async () => {
    const root = repoWithState(414);
    const h = harness(env({ PI_ENSEMBLE_WORKSPACE_ROOT: root }), ok);
    await h.turn();
    expect(h.calls).toHaveLength(0);
    expect(h.lines).toEqual(["project-knowledge polyfill: no block (no issue: ambiguous)"]);
  });

  test("found from the state file alone", async () => {
    const root = repoWithState(416);
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_ISSUE: undefined, PI_ENSEMBLE_WORKSPACE_ROOT: root }), ok);
    await h.turn();
    expect(h.calls[0]?.body.issue).toBe(416);
  });

  test("found from the worktree path in the context's cwd", async () => {
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_ISSUE: undefined }), ok);
    await h.turn({ cwd: "/repo/.worktrees/issue-418-default" });
    expect(h.calls[0]?.body.issue).toBe(418);
  });
});

describe("once per session", () => {
  test("a second turn makes no second request; a new session does", async () => {
    const h = harness(env(), ok);
    await h.turn();
    await h.turn();
    expect(h.calls).toHaveLength(1);
    await h.newSession();
    await h.turn();
    expect(h.calls).toHaveLength(2);
  });

  test("a failed request is not retried on the next turn", async () => {
    const h = harness(env(), () => new Response("no", { status: 500 }));
    await h.turn();
    await h.turn();
    expect(h.calls).toHaveLength(1);
    expect(h.lines).toEqual(["project-knowledge polyfill: no block (status)"]);
  });

  test("a turn started by a custom message asks nothing and keeps the session's one try", async () => {
    const h = harness(env(), ok);
    await h.pi.fire("before_agent_start", { messageType: "custom", message: { role: "custom" } }, {});
    expect(h.calls).toHaveLength(0);
    await h.turn();
    expect(h.calls).toHaveLength(1);
  });
});

describe("it never throws", () => {
  test("a seam that throws gives one line and no message", async () => {
    const h = harness(env({ PI_ENSEMBLE_KNOWLEDGE_ISSUE: undefined }), ok, {
      repoRoot: () => {
        throw new Error("boom");
      },
    });
    expect(await h.turn()).toBeUndefined();
    expect(h.lines).toEqual(["project-knowledge polyfill: no block (internal)"]);
  });

  test("a body that fails to read is network", async () => {
    const h = harness(env(), () => {
      const stream = new ReadableStream({
        pull(c) {
          c.error(new Error("reset"));
        },
      });
      return new Response(stream, { status: 200 });
    });
    expect(await h.turn()).toBeUndefined();
    expect(h.lines).toEqual(["project-knowledge polyfill: no block (network)"]);
  });
});
