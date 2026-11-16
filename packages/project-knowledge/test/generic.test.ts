// The package stays generic: it speaks of "a project knowledge source" and names no product or
// store behind one. The words are built from parts so this file does not hold them either.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const PACKAGE = join(import.meta.dir, "..");
const WORDS = [["yoko", "ten"], ["ware", "house"], ["indus", "try"]].map((p) => p.join(""));

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path));
    else out.push(path);
  }
  return out;
}

test("the package holds files to check", () => {
  expect(files(PACKAGE).length).toBeGreaterThan(5);
});

test("no file of the package names what is behind the source, in any case", () => {
  const hits: string[] = [];
  for (const path of files(PACKAGE)) {
    const text = readFileSync(path, "utf8").toLowerCase();
    const name = relative(PACKAGE, path).toLowerCase();
    for (const w of WORDS) if (text.includes(w) || name.includes(w)) hits.push(`${relative(PACKAGE, path)}: ${w.length} letters`);
  }
  expect(hits).toEqual([]);
});
