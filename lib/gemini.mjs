/**
 * @module gemini
 * Gemini API client for RescueRoute's AI-powered food-offer intake.
 * Sends a structured extraction request to the Gemini API and returns a
 * validated, cleaned donation draft. Falls back gracefully on all error
 * conditions so the application can degrade to local contextual reasoning.
 */
import { INTAKE_FIELDS, INTAKE_PROMPT } from "./intake-contract.mjs";

/**
 * Structured error thrown by {@link requestGemini} when the Gemini API call
 * cannot be completed successfully. The `code` property identifies the failure
 * category so callers can map it to a user-facing message.
 */
export class GeminiError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}
/** JSON schema sent to Gemini's `responseSchema` to enforce structured output for intake extraction. */
export const GEMINI_SCHEMA = {
  type: "OBJECT",
  required: INTAKE_FIELDS,
  propertyOrdering: INTAKE_FIELDS,
  properties: {
    name: { type: "STRING", nullable: true },
    food: { type: "STRING", nullable: true },
    meals: { type: "INTEGER", nullable: true },
    deadline: { type: "STRING", nullable: true },
    handling: { type: "STRING", enum: ["ambient", "chilled"], nullable: true },
    allergens: { type: "ARRAY", items: { type: "STRING" }, nullable: true },
  },
};
/**
 * Sends a food-offer intake message to the Gemini API and returns a parsed draft.
 * Applies a request timeout, validates the HTTP response status, and checks that
 * the model's output is well-formed. Throws {@link GeminiError} on any failure.
 * @param {string} message - The raw coordinator message to extract donation data from.
 * @param {{ key: string, model: string, fetcher?: typeof fetch, timeoutMs?: number, context?: object }} options - Request options.
 * @param {string} options.key - The Gemini API key.
 * @param {string} options.model - The Gemini model identifier (e.g. `gemini-3.8-flash`).
 * @param {typeof fetch} [options.fetcher=fetch] - Fetch implementation (injectable for tests).
 * @param {number} [options.timeoutMs=8000] - Request timeout in milliseconds.
 * @param {object} [options.context={}] - Scenario context forwarded to the system prompt.
 * @returns {Promise<{ draft: object, actualModel: string|null }>} Parsed draft object and the model version string reported by the API.
 * @throws {GeminiError} With a descriptive code on any API, network, or parsing error.
 */
export async function requestGemini(
  message,
  { key, model, fetcher = fetch, timeoutMs = 8000, context = {} },
) {
  if (!/^gemini-[a-z0-9.-]{1,100}$/.test(model))
    throw new GeminiError("model_configuration");
  const controller = new AbortController();
  let timer;
  const request = async () => {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: `${INTAKE_PROMPT}\nSimulation clock in minutes after midnight: ${Number.isInteger(context.now) ? context.now : "not supplied"}.`,
              },
            ],
          },
          contents: [{ role: "user", parts: [{ text: message }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: GEMINI_SCHEMA,
            maxOutputTokens: 2048,
            ...(model.startsWith("gemini-2.5-")
              ? { thinkingConfig: { thinkingBudget: 0 } }
              : /^gemini-3[.-]/.test(model)
                ? { thinkingConfig: { thinkingLevel: "LOW" } }
                : {}),
          },
        }),
      },
    );
    if (!response.ok)
      throw new GeminiError(
        [400, 401, 403].includes(response.status)
          ? "credentials_or_request"
          : response.status === 404
            ? "model_unavailable"
            : response.status === 429
              ? "rate_limited"
              : "provider_unavailable",
      );
    const result = await response.json();
    const candidate = result.candidates?.[0];
    if (
      !candidate ||
      candidate.finishReason !== "STOP" ||
      result.promptFeedback?.blockReason
    )
      throw new GeminiError("blocked_or_incomplete");
    const text = candidate.content?.parts
      ?.filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("");
    if (!text || text.length > 12000) throw new GeminiError("invalid_response");
    let draft;
    try {
      draft = JSON.parse(text);
    } catch {
      throw new GeminiError("invalid_response");
    }
    return {
      draft,
      actualModel:
        typeof result.modelVersion === "string"
          ? result.modelVersion.slice(0, 120)
          : null,
    };
  };
  try {
    return await Promise.race([
      request(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new GeminiError("timeout"));
        }, timeoutMs);
      }),
    ]);
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    throw new GeminiError(
      e?.name === "AbortError" ? "timeout" : "network_or_response",
    );
  } finally {
    clearTimeout(timer);
  }
}
