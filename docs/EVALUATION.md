# Evidence-based engineering scorecard

The supplied screenshot contains **six criteria**. Every criterion has a target of 100/100. The scores below are an internal readiness checklist, **not official judge scores, predicted competition results, or a claim of certification**. No official numerical weights were provided, so there is no weighted overall score. Security remains an additional medium-impact concern from the earlier challenge instructions.

Each row has five checks worth 20 points each: 20 for an implemented check with recorded evidence, 10 for partial implementation, and 0 for outstanding verification. These points assess completion of this checklist, not universal software quality. Implementation evidence includes code review; test evidence is identified separately.

| Criterion | Internal score | Target | Outstanding work |
| --- | ---: | ---: | --- |
| Testing | 80/100 | 100 | Real-provider evaluation and browser/device verification |
| Code quality | 90/100 | 100 | Further decomposition of the large frontend module |
| Accessibility | 80/100 | 100 | Browser contrast, keyboard, mobile, and screen-reader review |
| Problem alignment | 80/100 | 100 | Validation with actual food-rescue coordinators |
| GenAI excellence | 80/100 | 100 | Repeated semantic evaluation against the actual configured model |
| Efficiency & speed | 80/100 | 100 | Deployed concurrent-user and provider-latency measurements |

## Checks behind each score

| Criterion | Five checks and points |
| --- | --- |
| Testing | Domain/generated scenarios 20; HTTP/persistence/isolation 20; provider failure mocks 20; UI/fixture regression tests 20; real-provider/browser/device suite 0 |
| Code quality | Separated backend responsibilities 20; explicit contracts/validation 20; reproducible scripts and lockfile 20; pure planner with independent audit 20; frontend decomposition 10 |
| Accessibility | Semantic forms and labels 20; status/error feedback 20; textual map alternative 20; focus/reduced-motion/responsive CSS 20; actual browser/assistive-technology verification 0 |
| Problem alignment | Role-specific workflows 20; constrained matching 20; cancellation/replanning 20; receipt-based outcomes 20; real coordinator pilot 0 |
| GenAI excellence | Structured Gemini contract 20; instruction/data boundaries 20; independent source grounding 20; fallback/provenance/context 20; real-provider semantic results 0 |
| Efficiency & speed | Measured local extraction 20; bounded planner stress measurement 20; timeout/circuit/allowance controls 20; bounded storage/SSE/no runtime dependencies 20; deployed load/provider measurements 0 |

## Recorded evidence

- `npm test`: 67 passing automated tests, including 160 generated planning scenarios.
- `npm run evaluate`: 24/24 fixed local extraction fixtures. This small regression set is not an unrestricted-language accuracy estimate.
- Scoped axe-core checks: zero reported violations on four admin views for selected WCAG rules, with colour contrast excluded. jsdom cannot establish full WCAG conformance.
- `npm run check`: syntax checks across application, tests, and scripts.
- `npm audit`: no known vulnerabilities reported in the installed dependency tree at verification time; this is not a security audit.
- [Recorded local CPU benchmark](verification/benchmark.json): intake p95 0.032 ms, baseline planner p95 0.095 ms, bounded 30-offer/30-request/30-volunteer stress p95 66.446 ms; 600 portions allocated with a feasible audit. These are machine-specific CPU measurements, not HTTP or cloud response times.

See [testing limits](TESTING.md), [prompt evaluation](PROMPT_EVALUATION.md), and [AI architecture](AI_ARCHITECTURE.md). Hosted CI results must be checked independently; merely committing a workflow does not prove a successful run. A running-app Gemini request returned model-unavailable with successful labelled fallback. No successful live Gemini extraction, coordinator pilot, browser audit, or cloud load test has been recorded. Reporting 100/100 before those checks would conceal material gaps.

## Medium-impact security controls

The implementation includes salted password hashes, role/ownership enforcement, session revocation, CSRF/origin checks, output escaping, CSP, bounded bodies and provider requests, source-grounded drafts, and public workspace isolation. Provider keys stay server-side. Production operations still require unique private accounts, durable shared storage, operational monitoring, backups, and independent review. These controls do not imply a zero-error or production-certified architecture.
