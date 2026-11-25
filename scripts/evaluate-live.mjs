import { isDeepStrictEqual } from "node:util";
import { createIntakeService } from "../lib/intake.mjs";

// Explicit, bounded provider evaluation: never run in CI or normal startup.
if (!process.env.GEMINI_API_KEY) {
  console.error(
    "Set GEMINI_API_KEY in the server environment before live evaluation.",
  );
  process.exitCode = 2;
} else {
  const cases = [
    {
      id: "complete-declaration",
      message:
        "Donor: Test Deli\nFood: Rice boxes\n15 meals. Collect by 17:30.\nHandling: chilled\nAllergens: none",
      expected: {
        name: "Test Deli",
        food: "Rice boxes",
        meals: 15,
        deadline: "17:30",
        handling: "chilled",
        allergens: [],
      },
    },
    {
      id: "undeclared-allergens",
      message:
        "Donor: Test Bakery\nFood: Bread boxes\n8 meals. Collect by 18:00.\nHandling: ambient",
      expected: {
        name: "Test Bakery",
        food: "Bread boxes",
        meals: 8,
        deadline: "18:00",
        handling: "ambient",
        allergens: null,
      },
    },
    {
      id: "relative-deadline",
      message:
        "Donor: Test Kitchen\nFood: Lentil bowls\nTwenty meals. Collect within 30 minutes.\nHandling: ambient\nAllergens: none",
      expected: {
        name: "Test Kitchen",
        food: "Lentil bowls",
        meals: 20,
        deadline: "16:30",
        handling: "ambient",
        allergens: [],
      },
    },
  ];
  const service = createIntakeService();
  const results = [];
  for (const row of cases) {
    const result = await service.extract(row.message, { now: 960 });
    results.push({
      id: row.id,
      configuredModel: result.configuredModel,
      actualModel: result.actualModel,
      mode: result.mode,
      fallbackReason: result.fallback?.reason || null,
      providerAttempted: result.mode === "live" || result.fallback?.attempted,
      fieldsMatch: isDeepStrictEqual(row.expected, result.draft),
      livePass:
        result.mode === "live" && isDeepStrictEqual(row.expected, result.draft),
      timings: result.timings,
    });
  }
  const passed = results.filter((r) => r.livePass).length;
  console.log(
    JSON.stringify(
      {
        cases: cases.length,
        livePassed: passed,
        results,
        scope:
          "Three fixed synthetic messages, one run. Local fallback never counts as a live-model pass. Circuit-paused cases are marked unattempted. Not a general accuracy estimate.",
      },
      null,
      2,
    ),
  );
  if (passed !== cases.length) process.exitCode = 1;
}
