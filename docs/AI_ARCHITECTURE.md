# Gemini with explicit local fallback

Both paths produce an unapproved donation draft. Authorised users review missing fields, confirm donor declarations, and submit through the existing validated workflow. Model output has no access to tools, approvals, reservations, accounts, or delivery transitions.

```mermaid
flowchart TD
  A[Authenticated donation message] --> B[Validate input and compute local evidence]
  B --> C{Key, opt-in, budget, circuit available?}
  C -->|Yes| D[Gemini generateContent with JSON schema]
  D --> E{Response shape and source facts valid?}
  E -->|Yes| F[Gemini draft and returned model version]
  E -->|No| G[Local contextual draft and explicit reason]
  D -->|Timeout / offline / rejection| G
  C -->|No| G
  F --> H[Human review, completion, confirmation]
  G --> H
  H --> I[Domain validation and pending offer]
```

## Contract and provenance

The six fields are `name`, `food`, `meals`, `deadline`, `handling`, and `allergens`. Unknown values are null, including undeclared allergens. Empty allergens means an explicit declaration of none. The server checks exact keys, value types, bounds, allowed categories, and evidence. Name and food must occur literally in the message; non-null quantities, times, handling, and allergens must match the contextual rules. Unsupported or contradictory model facts cause local fallback.

The local engine creates a small typed graph of donation facts with relations such as `HAS_PORTIONS`, `COLLECT_BY`, and `DECLARES_ALLERGENS`. Relative deadlines can use the supplied simulation clock, with this derivation disclosed. This is deterministic extraction over supported language, not general semantic understanding or a broad world-knowledge graph. Conservative grounding can reject a valid Gemini interpretation outside that vocabulary.

The UI shows source, requested/reported model, completeness, questions, warnings, and expandable source facts. Native progress feedback covers actual request time. No fabricated token stream, deliberation, or hidden chain of thought is displayed.

## Failure containment

- No key: no provider request; use the local engine.
- Invalid credentials, unavailable model, rate limit, offline network, malformed or incomplete response, unsupported facts, or timeout: sanitised local fallback with an explicit reason.
- Default provider timeout: 8 seconds, configurable within a maximum of 20 seconds. Abort and a bounded race prevent a stalled provider from blocking indefinitely.
- Provider failure pauses subsequent attempts for 30 seconds. The next eligible request can retry; requests during the pause use local rules immediately.
- Public AI is disabled by default. Explicit opt-in enables at most 60 actual attempts per hour per process. This is a demo allowance, not a durable billing limit.
- Input, role, authentication, CSRF, and concurrency errors retain their normal HTTP errors. They do not masquerade as successful extraction.

## Configuration and model lifecycle

```dotenv
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
GEMINI_TIMEOUT_MS=8000
PUBLIC_AI_ENABLED=false
```

Keys are transmitted only in the server-side `x-goog-api-key` header. Google receives the submitted donation message, simulation clock, and extraction instructions. Account passwords, network records, GPS feeds, and the API key are not included in the model prompt.

On 25 November 2026, the owner approved Gemini 3.8 Flash after Google rejected 2.5 Flash for this account as unavailable to new users. The default is `gemini-3.8-flash`; [Google documents the model here](https://aistudio.google.com/docs/models/gemini-3.8-flash). Model discovery succeeded. Generation requests returned HTTP 503 due to high demand, and the application used labelled local fallback. This is provider-reachability and failure-path evidence, not successful live extraction. See `verification/gemini-status.json`.

Gemini 3.x requests use low thinking effort and a bounded output budget for extraction. The 2.5 adapter branch remains supported for owners with existing access. The reported `modelVersion` is displayed on successful extraction.

The REST request follows Google's [generateContent reference](https://aistudio.google.com/api-reference/generate-content). Its structured response contract uses `responseMimeType: application/json` and `responseSchema`; Google's [API discovery schema](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta) documents these fields. A JSON schema constrains shape, not factual accuracy.

## Verification boundary

Provider transport and failure paths have mocked tests; 24 fixed fixtures exercise local extraction. Gemini 3.8 generation verification returned 503 and exercised actual local fallback. Successful live extraction and semantic quality remain unverified. Domain tests independently check reservations, ownership, quantity conservation, ordering, and receipt confirmation. These controls reduce error exposure; they do not prove a zero-error system.
