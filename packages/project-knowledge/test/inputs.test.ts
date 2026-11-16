// The inputs of the upstream issue, read from an environment object.
import { describe, expect, test } from "bun:test";
import { inArm, readInputs } from "../inputs.ts";
import { URL_OK } from "./helpers.ts";

const BASE = { PI_ENSEMBLE_KNOWLEDGE_URL: URL_OK };

describe("the switch and the URL", () => {
  test("no URL: off, with no reason, so nothing is written", () => {
    expect(readInputs({})).toEqual({ on: false });
    expect(readInputs({ PI_ENSEMBLE_KNOWLEDGE_URL: "" })).toEqual({ on: false });
  });

  test("PI_ENSEMBLE_KNOWLEDGE=0 with a URL: off, with no reason (upstream test 2)", () => {
    expect(readInputs({ ...BASE, PI_ENSEMBLE_KNOWLEDGE: "0" })).toEqual({ on: false });
  });

  test("any other value of the switch leaves it on", () => {
    expect(readInputs({ ...BASE, PI_ENSEMBLE_KNOWLEDGE: "1" }).on).toBe(true);
    expect(readInputs({ ...BASE, PI_ENSEMBLE_KNOWLEDGE: "" }).on).toBe(true);
  });

  test("an https URL is taken as it is", () => {
    const got = readInputs(BASE);
    expect(got.on && got.url).toBe(URL_OK);
  });

  test("http is taken on loopback only", () => {
    for (const url of ["http://127.0.0.1:8080/x", "http://localhost:9/x", "http://[::1]:9/x"]) {
      expect(readInputs({ PI_ENSEMBLE_KNOWLEDGE_URL: url }).on).toBe(true);
    }
    expect(readInputs({ PI_ENSEMBLE_KNOWLEDGE_URL: "http://knowledge.example/x" })).toEqual({
      on: false,
      reason: "bad url",
    });
  });

  test("a URL that is not one, or another scheme, is a bad url", () => {
    for (const url of ["knowledge.example", "ftp://knowledge.example/x", "file:///etc/passwd", "https://"]) {
      expect(readInputs({ PI_ENSEMBLE_KNOWLEDGE_URL: url })).toEqual({ on: false, reason: "bad url" });
    }
  });

  test("a URL with a user or password in it is a bad url, so no secret rides in it", () => {
    expect(readInputs({ PI_ENSEMBLE_KNOWLEDGE_URL: "https://u:p@knowledge.example/x" })).toEqual({
      on: false,
      reason: "bad url",
    });
  });
});

describe("the token and the scope", () => {
  test("both are read as they are", () => {
    const got = readInputs({ ...BASE, PI_ENSEMBLE_KNOWLEDGE_TOKEN: "t-1", PI_ENSEMBLE_KNOWLEDGE_SCOPE: "r_7k2m" });
    expect(got.on && got.token).toBe("t-1");
    expect(got.on && got.scope).toBe("r_7k2m");
  });

  test("unset: an empty token and no scope", () => {
    const got = readInputs(BASE);
    expect(got.on && got.token).toBe("");
    expect(got.on && got.scope).toBeUndefined();
  });
});

describe("the arm", () => {
  test("default all; even and odd are read", () => {
    const arm = (v?: string) => {
      const got = readInputs(v === undefined ? BASE : { ...BASE, PI_ENSEMBLE_KNOWLEDGE_ISSUES: v });
      return got.on ? got.arm : got;
    };
    expect(arm()).toBe("all");
    expect(arm("all")).toBe("all");
    expect(arm("even")).toBe("even");
    expect(arm("odd")).toBe("odd");
  });

  test("any other value makes no request: a trial arm is never guessed", () => {
    for (const v of ["EVEN", "both", "1", " even"]) {
      expect(readInputs({ ...BASE, PI_ENSEMBLE_KNOWLEDGE_ISSUES: v })).toEqual({
        on: false,
        reason: "bad issues setting",
      });
    }
  });

  test("even asks for 412, not 413; odd is the reverse (upstream test 3)", () => {
    expect(inArm("even", 412)).toBe(true);
    expect(inArm("even", 413)).toBe(false);
    expect(inArm("odd", 412)).toBe(false);
    expect(inArm("odd", 413)).toBe(true);
    expect(inArm("all", 412)).toBe(true);
    expect(inArm("all", 413)).toBe(true);
  });
});

describe("the time limit", () => {
  const limit = (v?: string) => {
    const got = readInputs(v === undefined ? BASE : { ...BASE, PI_ENSEMBLE_KNOWLEDGE_TIMEOUT_MS: v });
    return got.on ? got.timeoutMs : -1;
  };

  test("default 3000", () => {
    expect(limit()).toBe(3000);
  });

  test("a whole number up to 8000 is taken", () => {
    expect(limit("1")).toBe(1);
    expect(limit("250")).toBe(250);
    expect(limit("8000")).toBe(8000);
  });

  test("above 8000 is 8000", () => {
    expect(limit("8001")).toBe(8000);
    expect(limit("600000")).toBe(8000);
  });

  test("anything else is the default", () => {
    for (const v of ["", "0", "-5", "1.5", "abc", "3e3", "Infinity"]) expect(limit(v)).toBe(3000);
  });
});

describe("the title switch and the issue override", () => {
  test("the title is on unless PI_ENSEMBLE_KNOWLEDGE_TITLE=0", () => {
    const title = (v?: string) => {
      const got = readInputs(v === undefined ? BASE : { ...BASE, PI_ENSEMBLE_KNOWLEDGE_TITLE: v });
      return got.on && got.title;
    };
    expect(title()).toBe(true);
    expect(title("1")).toBe(true);
    expect(title("0")).toBe(false);
  });

  test("PI_ENSEMBLE_KNOWLEDGE_ISSUE is a positive whole number or nothing", () => {
    const issue = (v: string) => {
      const got = readInputs({ ...BASE, PI_ENSEMBLE_KNOWLEDGE_ISSUE: v });
      return got.on ? got.issue : null;
    };
    expect(issue("412")).toBe(412);
    expect(issue("0")).toBeUndefined();
    expect(issue("-3")).toBeUndefined();
    expect(issue("41x")).toBeUndefined();
    expect(issue("")).toBeUndefined();
  });
});
