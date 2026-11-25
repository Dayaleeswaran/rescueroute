import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { localReasoning } from "../lib/local-intake.mjs";

export function evaluateIntake() {
  const cases = JSON.parse(
    readFileSync(
      new URL("../test/fixtures/intake-cases.json", import.meta.url),
      "utf8",
    ),
  );
  const failures = [];
  for (const example of cases) {
    const actual = localReasoning(example.message, example.context).draft;
    for (const [field, expected] of Object.entries(example.expected))
      if (!isDeepStrictEqual(actual[field], expected))
        failures.push({
          id: example.id,
          field,
          expected,
          actual: actual[field],
        });
  }
  return {
    engine: "local-context",
    cases: cases.length,
    passed: cases.length - new Set(failures.map((f) => f.id)).size,
    failures,
    scope:
      "Fixed deterministic fixtures; not a live Gemini accuracy or judging score.",
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = evaluateIntake();
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}
