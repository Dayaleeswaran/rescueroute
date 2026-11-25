/**
 * @module local-intake
 * Zero-latency, offline local contextual reasoner for food-offer intake.
 * Applies a cascade of regex-based heuristics to extract donation fields from
 * free-text coordinator messages without requiring any network calls.
 * Results are always supervised and must be confirmed by a human coordinator
 * before any record is created. Also provides a grounding check to validate
 * model-generated drafts against the original message.
 */
import { cleanDraft, emptyDraft, INTAKE_FIELDS } from "./intake-contract.mjs";

const WORDS = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};
const numberWords = Object.keys(WORDS).join("|");
const normal = (s) => s.toLowerCase().replace(/\s+/g, " ").trim();
const clock = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const relations = {
  name: "HAS_DONOR",
  food: "HAS_FOOD",
  meals: "HAS_PORTIONS",
  deadline: "COLLECT_BY",
  handling: "REQUIRES_TRANSPORT",
  allergens: "DECLARES_ALLERGENS",
};

function wordNumber(s) {
  const words = normal(s)
    .replaceAll("-", " ")
    .split(" ");
  let hundreds = 0;
  if (words[0] === "hundred") {
    hundreds = 100;
    words.shift();
  } else if (words[1] === "hundred" && WORDS[words[0]] >= 1 && WORDS[words[0]] <= 9) {
    hundreds = WORDS[words.shift()] * 100;
    words.shift();
  }
  if (hundreds && words[0] === "and") words.shift();
  if (!words.length) return hundreds || null;
  const first = WORDS[words[0]];
  if (!Number.isInteger(first) || first >= 100) return null;
  if (words.length === 1) return hundreds + first;
  const last = WORDS[words[1]];
  return words.length === 2 && first >= 20 && last >= 1 && last <= 9
    ? hundreds + first + last
    : null;
}
function labelled(message, labels) {
  const expression = new RegExp(
    `(?:^|[\\n;]|\\.\\s+)(?:${labels}):\\s*([^\\n;]+?)(?=\\s*(?:\\n|;|\\.\\s+(?:donor|from|food|allergens|contains|handling|transport|collect|pickup)\\b|$))`,
    "gi",
  );
  return [...message.matchAll(expression)].map((m) => ({
    value: m[1].replace(/[.\s]+$/, ""),
    start: m.index,
    end: m.index + m[0].length,
    text: m[0].trim(),
  }));
}

/**
 * Runs the local contextual reasoner over a raw coordinator message.
 * Extracts up to six donation fields using regex-based pattern matching
 * without any network calls. Fields that cannot be determined are set to null.
 * Detects prompt-injection attempts and limits extraction accordingly.
 * @param {string} message - The raw message text from the coordinator.
 * @param {{ now?: number, donors?: Array<{ name: string }> }} [context={}] - Optional scenario context.
 * @param {number} [context.now] - Simulation clock in minutes after midnight (for relative deadline resolution).
 * @param {Array<{ name: string }>} [context.donors] - Known donor names for name-matching.
 * @returns {{ draft: object, warnings: string[], evidence: object, graph: { nodes: object[], edges: object[] }, conflicts: string[] }} Extraction result.
 */
export function localReasoning(message, context = {}) {
  const draft = emptyDraft(),
    evidence = {},
    warnings = [],
    conflicts = new Set();
  const set = (field, value, source, derived = false) => {
    if (
      draft[field] !== null &&
      JSON.stringify(draft[field]) !== JSON.stringify(value)
    ) {
      draft[field] = null;
      conflicts.add(field);
      return;
    }
    if (conflicts.has(field)) return;
    draft[field] = value;
    evidence[field] = {
      text: source.text,
      start: source.start ?? null,
      end: source.end ?? null,
      kind: derived ? "derived-from-clock" : "explicit",
    };
  };
  const suspicious =
    /ignore.{0,35}(?:instructions|system|rules)|reveal.{0,35}(?:key|secret|prompt)|system prompt|<\|(?:system|assistant)/i.test(
      message,
    );
  if (suspicious)
    warnings.push(
      "Instruction-like text was detected. Only clearly stated donation fields are considered; no instructions are executed.",
    );
  for (const [field, labels] of [
    ["name", "donor|from"],
    ["food", "food"],
  ])
    for (const item of labelled(message, labels))
      if (item.value && item.value.length <= 120) set(field, item.value, item);
  if (draft.name === null && !suspicious && Array.isArray(context.donors)) {
    const matches = context.donors.filter(
      (d) =>
        typeof d.name === "string" && normal(message).includes(normal(d.name)),
    );
    if (matches.length === 1) {
      const start = message
        .toLowerCase()
        .indexOf(matches[0].name.toLowerCase());
      set("name", matches[0].name, {
        text: matches[0].name,
        start,
        end: start < 0 ? null : start + matches[0].name.length,
      });
    }
  }
  const quantityPattern = new RegExp(
    `(?<![\\w.])(-?\\d+(?:\\.\\d+)?|(?:${numberWords})(?:[ -](?:${numberWords}|and)){0,3})\\s+(?:meal\\s+boxes|meals?|portions?|servings?|boxes|(?:[a-z]+\\s+){0,2}bowls)\\b`,
    "gi",
  );
  const quantities = [...message.matchAll(quantityPattern)];
  for (const item of quantities) {
    if (suspicious && !/(?:^|\n)\s*(?:meals|portions|quantity):/i.test(message))
      break;
    const n = /^-?\d/.test(item[1]) ? Number(item[1]) : wordNumber(item[1]);
    if (!Number.isInteger(n) || n < 1 || n > 1000) {
      conflicts.add("meals");
      draft.meals = null;
      warnings.push(
        "A portion count is invalid or outside the supported 1–1,000 range. Confirm the actual quantity.",
      );
    } else
      set("meals", n, {
        text: item[0],
        start: item.index,
        end: item.index + item[0].length,
      });
  }
  for (const item of labelled(message, "meals|portions|quantity")) {
    const n = Number(item.value);
    if (Number.isInteger(n) && n >= 1 && n <= 1000) set("meals", n, item);
  }
  const deadlinePattern =
    /\b(?:collect(?:ion)?(?:\s+(?:by|before|until|at))?|pickup(?:\s+(?:by|before|until|at))?|by|before|until|closes? at)\s+((?:[01]?\d|2[0-3]):[0-5]\d\s*(?:am|pm)?|(?:0?[1-9]|1[0-2])\s*(?:am|pm))\b/gi;
  if (
    !/\btomorrow\b|\bnext\s+(?:day|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(
      message,
    )
  ) {
    for (const item of message.matchAll(deadlinePattern)) {
      const value = item[1].toLowerCase(),
        meridiem = value.match(/am|pm/)?.[0];
      const [rawH, m = 0] = value
        .replace(/\s*(?:am|pm)/g, "")
        .split(":")
        .map(Number);
      let h = rawH;
      if (meridiem) {
        if (h < 1 || h > 12) continue;
        h = (h % 12) + (meridiem === "pm" ? 12 : 0);
      }
      set("deadline", clock(h * 60 + m), {
        text: item[0],
        start: item.index,
        end: item.index + item[0].length,
      });
    }
    const relative = message.match(
      /\b(?:collect|pickup)\s+(?:within|in)\s+(\d{1,3})\s+minutes?\b/i,
    );
    if (
      relative &&
      Number.isInteger(context.now) &&
      context.now >= 0 &&
      context.now < 1440
    ) {
      const n = context.now + Number(relative[1]);
      if (n < 1440) {
        set(
          "deadline",
          clock(n),
          {
            text: relative[0],
            start: relative.index,
            end: relative.index + relative[0].length,
          },
          true,
        );
        warnings.push(
          `Relative collection time uses the simulation clock ${clock(context.now)}. Confirm this interpretation.`,
        );
      } else
        warnings.push(
          "The relative deadline crosses midnight; a same-day collection time is required.",
        );
    }
  } else
    warnings.push(
      "A different collection day was mentioned. This scenario needs a same-day collection time.",
    );
  for (const item of labelled(message, "handling|transport"))
    if (/^(ambient|chilled)$/i.test(item.value))
      set("handling", item.value.toLowerCase(), item);
  for (const item of message.matchAll(
    /\b(?:requires?|needs?|must use)\s+(ambient|chilled|refrigerated)\s+transport\b/gi,
  )) {
    if (
      /\b(?:no|not|doesn't|don't)\b.{0,12}$/i.test(
        message.slice(Math.max(0, item.index - 20), item.index),
      )
    )
      continue;
    set(
      "handling",
      item[1].toLowerCase() === "refrigerated"
        ? "chilled"
        : item[1].toLowerCase(),
      { text: item[0], start: item.index, end: item.index + item[0].length },
    );
  }
  for (const item of labelled(message, "allergens|contains")) {
    if (
      /\b(?:unknown|unsure|not known|not provided|not confirmed)\b/i.test(
        item.value,
      )
    ) {
      conflicts.add("allergens");
      draft.allergens = null;
      continue;
    }
    const values = /^(?:none|no allergens)$/i.test(item.value)
      ? []
      : item.value.split(",").map((v) => v.trim().toLowerCase());
    if (values.some((v) => /^(?:none|no allergens)$/.test(v))) {
      conflicts.add("allergens");
      draft.allergens = null;
      continue;
    }
    set("allergens", [...new Set(values)].sort(), item);
  }
  for (const field of conflicts) {
    draft[field] = null;
    delete evidence[field];
    warnings.push(
      `Conflicting or uncertain ${field === "meals" ? "portion counts" : field} require clarification.`,
    );
  }
  const cleaned = cleanDraft(draft);
  for (const key of INTAKE_FIELDS)
    if (cleaned[key] === null) delete evidence[key];
  const nodes = [{ id: "offer", type: "DonationOffer" }],
    edges = [];
  for (const key of INTAKE_FIELDS)
    if (cleaned[key] !== null) {
      nodes.push({
        id: key,
        type: key,
        value: cleaned[key],
        evidence: evidence[key],
      });
      edges.push({ from: "offer", relation: relations[key], to: key });
    }
  if (evidence.deadline?.kind === "derived-from-clock") {
    nodes.push({
      id: "clock",
      type: "SimulationClock",
      value: clock(context.now),
    });
    edges.push({ from: "deadline", relation: "BASED_ON_CLOCK", to: "clock" });
  }
  return {
    draft: cleaned,
    warnings: [...new Set(warnings)],
    evidence,
    graph: { nodes, edges },
    conflicts: [...conflicts],
  };
}

/**
 * Verifies that a Gemini model draft is grounded in the original message
 * and consistent with the local reasoning result for structured fields.
 * Returns false (causing fallback to local mode) if any name or food value
 * is not found verbatim in the message, or if structured fields disagree
 * with local extraction on non-conflicted values.
 * @param {object} raw - The raw model draft to validate.
 * @param {string} message - The original coordinator message.
 * @param {{ draft: object, conflicts: string[] }} local - Local reasoning result for grounding comparison.
 * @returns {boolean} True if the model draft passes all grounding checks.
 */
export function groundModelDraft(raw, message, local) {
  for (const field of ["name", "food"])
    if (raw[field] !== null && !normal(message).includes(normal(raw[field])))
      return false;
  for (const field of ["meals", "deadline", "handling", "allergens"]) {
    if (raw[field] === null) continue;
    const candidate = Array.isArray(raw[field])
      ? [...raw[field]].map(normal).sort()
      : raw[field];
    const fact = Array.isArray(local.draft[field])
      ? [...local.draft[field]].map(normal).sort()
      : local.draft[field];
    if (
      local.conflicts.includes(field) ||
      JSON.stringify(candidate) !== JSON.stringify(fact)
    )
      return false;
  }
  return true;
}
