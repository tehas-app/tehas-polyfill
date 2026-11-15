// The per-step table of the upstream issue, and how a child reaches its row. A child knows its
// role (`PI_ENSEMBLE_ROLE`), not its step, so the role picks the steps it may ask for. The explore
// role runs both the explore and the plan step; the driver's state file says which.
import type { Step, StepRow } from "./types.ts";

export const STEPS: Readonly<Record<Step, StepRow>> = Object.freeze({
  explore: { step: "explore", kinds: ["environment", "failure-pattern"], lines: 8 },
  plan: { step: "plan", kinds: ["decision", "convention", "ticket-adjustment", "failure-pattern"], lines: 10 },
  develop: { step: "develop", kinds: ["convention", "environment", "review-feedback", "failure-pattern"], lines: 5 },
  "lens-review": { step: "lens-review", kinds: ["review-feedback", "convention"], lines: 5 },
});

/**
 * The steps each role may ask for; the first is its own. The adversarial developer and ops are
 * not here: the gate stays independent of what the developer was told, and ops asks for nothing.
 */
const ROLE_STEPS: ReadonlyMap<string, readonly Step[]> = new Map<string, readonly Step[]>([
  ["explore", ["explore", "plan"]],
  ["project-manager", ["plan"]],
  ["developer", ["develop"]],
  ["code-review-specialist", ["lens-review"]],
]);

/** The row for a role, taking the driver's step when the role runs it. Undefined: make no request. */
export function stepFor(role: string | undefined, driverStep: string | undefined): StepRow | undefined {
  if (role === undefined) return undefined;
  const steps = ROLE_STEPS.get(role);
  const own = steps?.[0];
  if (steps === undefined || own === undefined) return undefined;
  const step = steps.find((s) => s === driverStep) ?? own;
  const row = STEPS[step];
  return { step: row.step, kinds: [...row.kinds], lines: row.lines };
}
