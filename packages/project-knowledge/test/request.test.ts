// The request body: exactly the fields of the upstream issue (upstream test 5).
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readTitle } from "../issue.ts";
import { buildRequest, toQuery } from "../request.ts";
import { STEPS } from "../roles.ts";
import { BODY, BODY_MARKER, cleanup, scratch, TITLE, TITLE_MARKER, writeState } from "./helpers.ts";

const GOLDEN = join(import.meta.dir, "request.golden.json");

describe("the title as search words", () => {
  test("letters and digits only, lower case, one space between", () => {
    expect(toQuery("Run the MIGRATIONS, web:html db_sqlite!")).toBe("run the migrations web html db sqlite");
  });

  test("letters of any script are kept", () => {
    expect(toQuery("Päivitä käännös — 日本語 v2")).toBe("päivitä käännös 日本語 v2");
  });

  test("nothing left is no query", () => {
    expect(toQuery(" -- ")).toBeUndefined();
    expect(toQuery("")).toBeUndefined();
    expect(toQuery(undefined)).toBeUndefined();
  });

  test("at most 200 characters, and no word is cut in half", () => {
    const q = toQuery(`${"abcdefghi ".repeat(30)}tail`) ?? "";
    expect(q.length).toBeLessThanOrEqual(200);
    expect(q.split(" ").every((w) => w === "abcdefghi")).toBe(true);
  });

  test("one word longer than 200 characters is cut at 200", () => {
    expect(toQuery("a".repeat(250))).toBe("a".repeat(200));
  });

  test("a pasted address or key-like string does not go out whole", () => {
    const q = toQuery("Fails at https://user:pw@host.example:8443/x?k=v with sk-ab_12") ?? "";
    expect(q).toBe("fails at https user pw host example 8443 x k v with sk ab 12");
    expect(q).not.toContain("://");
    expect(q).not.toContain("@");
  });
});

describe("the body", () => {
  const row = STEPS.develop;

  test("holds exactly the fields of the upstream issue, in its order", () => {
    const body = buildRequest({ scope: "r_7k2m", issue: 412, row, model: "example-model-1", title: TITLE });
    expect(Object.keys(body)).toEqual(["contract", "scope", "issue", "step", "kinds", "limit", "agent", "model", "q"]);
    expect(body.contract).toBe(1);
    expect(body.agent).toBe("pi-rukas");
    expect(body.step).toBe("develop");
    expect(body.kinds).toEqual(["convention", "environment", "review-feedback", "failure-pattern"]);
    expect(body.limit).toBe(5);
  });

  test("equals the golden, which a source's tests copy as their fixture", () => {
    const body = buildRequest({ scope: "r_7k2m", issue: 412, row, model: "example-model-1", title: "Retry the upload when the store is busy" });
    expect(JSON.parse(readFileSync(GOLDEN, "utf8"))).toEqual(body);
  });

  test("leaves out scope, model and q when they are not known", () => {
    const body = buildRequest({ scope: undefined, issue: 412, row, model: undefined, title: undefined });
    expect(Object.keys(body)).toEqual(["contract", "issue", "step", "kinds", "limit", "agent"]);
  });

  test("an empty model is not sent", () => {
    expect("model" in buildRequest({ scope: undefined, issue: 1, row, model: "", title: undefined })).toBe(false);
  });

  test("the kinds are a copy of the row, not the row", () => {
    const body = buildRequest({ scope: undefined, issue: 1, row, model: undefined, title: undefined });
    body.kinds.push("x");
    expect(STEPS.develop.kinds).toHaveLength(4);
  });
});

describe("a marker in the issue reaches no request (upstream test 5)", () => {
  const root = scratch("request");
  afterAll(() => cleanup(root));
  writeState(root, { issue: 412, ownerPid: 1, title: TITLE, body: BODY });
  const title = readTitle(join(root, ".pi", "work-state"), 412);

  test("the title is read from the driver's file", () => {
    expect(title).toBe(TITLE);
  });

  for (const step of Object.values(STEPS)) {
    test(`with the title on, step ${step.step}: neither marker is in the body`, () => {
      const text = JSON.stringify(buildRequest({ scope: "r_7k2m", issue: 412, row: step, model: "m", title }));
      expect(text).not.toContain(TITLE_MARKER);
      expect(text).not.toContain(BODY_MARKER);
      expect(text.toLowerCase()).not.toContain(BODY_MARKER.toLowerCase());
      expect(text).not.toContain("must not be sent");
    });
  }

  test("with the title off, no word of the issue is in the body", () => {
    const text = JSON.stringify(buildRequest({ scope: "r_7k2m", issue: 412, row: STEPS.plan, model: "m", title: undefined }));
    expect(text.toLowerCase()).not.toContain("subtract");
    expect(text.toLowerCase()).not.toContain("qx7");
    expect(text).not.toContain(BODY_MARKER);
  });
});
