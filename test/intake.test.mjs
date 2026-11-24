import test from "node:test";
import assert from "node:assert/strict";
import { extractOffer, parseLocal, cleanDraft } from "../lib/intake.mjs";

test("local intake extracts explicit facts and preserves unknowns", () => {
  const d = parseLocal(
    "Donor: Test Deli\nFood: Rice boxes\n15 meals. Collect by 17:30.\nHandling: chilled\nAllergens: none",
  );
  assert.deepEqual(d, {
    name: "Test Deli",
    food: "Rice boxes",
    meals: 15,
    deadline: "17:30",
    handling: "chilled",
    allergens: [],
  });
  assert.equal(parseLocal("15 meals of peanut noodles").allergens, null);
  assert.equal(parseLocal("for 15 people, collection tomorrow").meals, null);
});
test("parser handles explicit am/pm and does not invent a missing time", () => {
  assert.equal(parseLocal("Collect by 5:30 pm").deadline, "17:30");
  assert.equal(parseLocal("Collect by 12:30 am").deadline, "00:30");
  assert.equal(parseLocal("Collect soon").deadline, null);
});
test("output cleaning rejects malformed model fields", () => {
  const d = cleanDraft({
    meals: -20,
    deadline: "27:99",
    handling: "safe",
    allergens: [false],
  });
  assert.equal(d.meals, null);
  assert.equal(d.deadline, null);
  assert.equal(d.handling, null);
  assert.equal(d.allergens, null);
});
test("live adapter uses structured output and validates its response", async () => {
  const result = await extractOffer("Some untrusted input", {
    key: "test-only",
    fetcher: async (url, options) => {
      assert.equal(url, "https://api.openai.com/v1/chat/completions");
      const payload = JSON.parse(options.body);
      assert.equal(payload.response_format.json_schema.strict, true);
      assert.equal(payload.messages[1].role, "user");
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  meals: 10,
                  deadline: "17:00",
                  allergens: null,
                }),
              },
            },
          ],
        }),
      };
    },
  });
  assert.equal(result.mode, "live");
  assert.equal(result.draft.meals, 10);
  assert.ok(result.questions.length);
});
test("provider failures and invalid input fail explicitly", async () => {
  await assert.rejects(extractOffer("", { key: "" }));
  await assert.rejects(extractOffer("x".repeat(3001), { key: "" }));
  await assert.rejects(
    extractOffer("10 meals", {
      key: "test",
      fetcher: async () => ({ ok: false }),
    }),
  );
});
