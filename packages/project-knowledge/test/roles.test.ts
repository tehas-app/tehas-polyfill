// The per-step table of the upstream issue, reached from the child's role (upstream test 7).
import { describe, expect, test } from "bun:test";
import { STEPS, stepFor } from "../roles.ts";

describe("the per-step table", () => {
  test("each step asks its own kinds and keeps its own line count", () => {
    expect(STEPS.explore).toEqual({ step: "explore", kinds: ["environment", "failure-pattern"], lines: 8 });
    expect(STEPS.plan).toEqual({
      step: "plan",
      kinds: ["decision", "convention", "ticket-adjustment", "failure-pattern"],
      lines: 10,
    });
    expect(STEPS.develop).toEqual({
      step: "develop",
      kinds: ["convention", "environment", "review-feedback", "failure-pattern"],
      lines: 5,
    });
    expect(STEPS["lens-review"]).toEqual({ step: "lens-review", kinds: ["review-feedback", "convention"], lines: 5 });
  });
});

describe("a role finds its step", () => {
  test("developer: develop, whatever the driver's step", () => {
    expect(stepFor("developer", undefined)?.step).toBe("develop");
    expect(stepFor("developer", "lens")?.step).toBe("develop");
  });

  test("code-review-specialist: lens-review", () => {
    expect(stepFor("code-review-specialist", undefined)?.step).toBe("lens-review");
    expect(stepFor("code-review-specialist", "develop")?.step).toBe("lens-review");
  });

  test("project-manager, if it is ever a child: plan", () => {
    expect(stepFor("project-manager", undefined)?.step).toBe("plan");
  });

  test("explore runs the explore and the plan step; the driver's state tells which", () => {
    expect(stepFor("explore", "explore")?.step).toBe("explore");
    expect(stepFor("explore", "plan")?.step).toBe("plan");
    expect(stepFor("explore", undefined)?.step).toBe("explore");
    // A step the explore role does not run is not trusted: the role's own step is used.
    expect(stepFor("explore", "develop")?.step).toBe("explore");
  });

  test("adversarial-developer and ops make no request, whatever the driver's step", () => {
    for (const step of [undefined, "develop", "plan", "explore"]) {
      expect(stepFor("adversarial-developer", step)).toBeUndefined();
      expect(stepFor("ops", step)).toBeUndefined();
    }
  });

  test("no role, or one this table does not name, makes no request", () => {
    expect(stepFor(undefined, "develop")).toBeUndefined();
    expect(stepFor("", "develop")).toBeUndefined();
    expect(stepFor("Developer", undefined)).toBeUndefined();
    expect(stepFor("toString", undefined)).toBeUndefined();
  });

  test("a row is a copy: changing it does not change the table", () => {
    const row = stepFor("developer", undefined);
    (row?.kinds as string[]).push("x");
    expect(STEPS.develop.kinds).toHaveLength(4);
  });
});
