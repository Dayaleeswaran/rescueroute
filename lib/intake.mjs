import { performance } from "node:perf_hooks";
import { InputError } from "./validation.mjs";
import {
  cleanDraft,
  INTAKE_FIELDS,
  validModelDraft,
} from "./intake-contract.mjs";
import { localReasoning, groundModelDraft } from "./local-intake.mjs";
import { requestGemini } from "./gemini.mjs";

export { cleanDraft, INTAKE_PROMPT } from "./intake-contract.mjs";
export const parseLocal = (message, context) =>
  localReasoning(message, context).draft;

const explanations = {
  missing_key: "No Gemini key is configured. Local contextual rules were used.",
  disabled_public:
    "External AI is disabled for this public demo. Local contextual rules were used.",
  credentials_or_request:
    "Gemini rejected the credentials or request. Local contextual rules were used.",
  model_unavailable:
    "The requested Gemini model is unavailable. Local contextual rules were used.",
  model_configuration:
    "The configured Gemini model name is invalid. Local contextual rules were used.",
  rate_limited:
    "Gemini rate-limited the request. Local contextual rules were used.",
  provider_unavailable:
    "Gemini is temporarily unavailable. Local contextual rules were used.",
  timeout: "Gemini exceeded the time limit. Local contextual rules were used.",
  network_or_response:
    "Gemini could not be reached or its response could not be read. Local contextual rules were used.",
  invalid_response:
    "Gemini returned an invalid draft. Local contextual rules were used.",
  blocked_or_incomplete:
    "Gemini blocked or did not complete the response. Local contextual rules were used.",
  ungrounded_response:
    "The generated facts could not be verified against the message. Local contextual rules were used.",
  cooling_down:
    "Gemini requests are briefly paused after a failure. Local contextual rules were used.",
  public_budget:
    "This demo reached its bounded AI request allowance. Local contextual rules were used.",
};
const questions = {
  name: "Who is donating?",
  food: "What food is available?",
  meals: "How many meal portions are available?",
  deadline: "What is the same-day collection deadline (24-hour time)?",
  handling: "Is ambient or chilled transport required?",
  allergens: "Which allergens has the donor explicitly declared?",
};

export function createIntakeService({
  key = process.env.GEMINI_API_KEY || "",
  model = process.env.GEMINI_MODEL || "gemini-2.5-flash",
  fetcher = fetch,
  timeoutMs = 8000,
  now = Date.now,
  maxRequestsPerHour = Infinity,
  localOnlyReason,
} = {}) {
  const timeout = Number.isFinite(Number(timeoutMs))
    ? Math.max(20, Math.min(20000, Number(timeoutMs)))
    : 8000;
  let retryAt = 0,
    windowStart = now(),
    requests = 0;
  return {
    async extract(message, context = {}) {
      if (
        typeof message !== "string" ||
        !message.trim() ||
        message.length > 3000
      )
        throw new InputError("Enter a message containing 1–3,000 characters.");
      const started = performance.now(),
        local = localReasoning(message, context);
      let draft = local.draft,
        mode = "local",
        actualModel = null,
        fallback = null,
        providerMs = 0,
        attempted = false;
      let reason =
        localOnlyReason ||
        (!key ? "missing_key" : now() < retryAt ? "cooling_down" : null);
      if (now() - windowStart >= 3600000) {
        windowStart = now();
        requests = 0;
      }
      if (!reason && requests >= maxRequestsPerHour) reason = "public_budget";
      if (!reason) {
        attempted = true;
        requests++;
        const providerStart = performance.now();
        try {
          const result = await requestGemini(message, {
            key,
            model,
            fetcher,
            timeoutMs: timeout,
            context,
          });
          if (!validModelDraft(result.draft)) reason = "invalid_response";
          else if (!groundModelDraft(result.draft, message, local))
            reason = "ungrounded_response";
          else {
            draft = cleanDraft(result.draft);
            actualModel = result.actualModel;
            mode = "live";
          }
        } catch (e) {
          reason = Object.hasOwn(explanations, e?.code)
            ? e.code
            : "network_or_response";
        } finally {
          providerMs = performance.now() - providerStart;
        }
        if (reason) retryAt = now() + 30000;
      }
      if (reason)
        fallback = {
          reason,
          attempted,
          message: explanations[reason] || explanations.network_or_response,
        };
      const evidence = { ...local.evidence };
      for (const field of INTAKE_FIELDS)
        if (draft[field] === null) delete evidence[field];
      if (mode === "live")
        for (const field of ["name", "food"])
          if (draft[field] !== null)
            evidence[field] = {
              text: draft[field],
              kind: "literal-source-match",
              start: null,
              end: null,
            };
      const graph = {
        nodes: [{ id: "offer", type: "DonationOffer" }],
        edges: [],
      };
      for (const node of local.graph.nodes.filter((n) => n.id !== "offer"))
        if (node.id === "clock" || draft[node.id] !== null)
          graph.nodes.push({
            ...node,
            ...(node.id === "clock"
              ? {}
              : { value: draft[node.id], evidence: evidence[node.id] }),
          });
      for (const field of ["name", "food"])
        if (draft[field] !== null && !graph.nodes.some((n) => n.id === field))
          graph.nodes.push({
            id: field,
            type: field,
            value: draft[field],
            evidence: evidence[field],
          });
      graph.edges = local.graph.edges.filter(
        (edge) =>
          graph.nodes.some((n) => n.id === edge.to) &&
          graph.nodes.some((n) => n.id === edge.from),
      );
      for (const [field, relation] of [
        ["name", "HAS_DONOR"],
        ["food", "HAS_FOOD"],
      ])
        if (draft[field] !== null && !graph.edges.some((e) => e.to === field))
          graph.edges.push({ from: "offer", relation, to: field });
      return {
        draft,
        mode,
        provider: mode === "live" ? "gemini" : "local-context",
        configuredModel: model,
        actualModel,
        fallback,
        questions: INTAKE_FIELDS.filter((k) => draft[k] === null).map(
          (k) => questions[k],
        ),
        warnings: local.warnings,
        evidence,
        graph,
        completeness: {
          known: INTAKE_FIELDS.filter((k) => draft[k] !== null).length,
          total: INTAKE_FIELDS.length,
        },
        timings: {
          totalMs: Math.round((performance.now() - started) * 100) / 100,
          providerMs: Math.round(providerMs * 100) / 100,
        },
        notice:
          "This is an unapproved draft. Confirm the location, suitability, quantities, handling, and declared allergens with the donor before adding it.",
      };
    },
  };
}

export async function extractOffer(message, options = {}) {
  return createIntakeService(options).extract(message, options.context);
}
