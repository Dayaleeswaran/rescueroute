# Six-criterion quality targets

The owner set a **98/100 target for each of six criteria**. These are improvement targets, not awarded scores or a prediction of the competition evaluator. No official numeric weighting or scoring function has been supplied. Code quality and problem alignment were identified as high impact; security and efficiency as medium impact; testing and accessibility as normal impact.

| Criterion | Impact | Target | Implemented evidence | Remaining verification |
| --- | --- | ---: | --- | --- |
| Code quality | High | 98/100 | Strict ESLint recommended rules with zero errors/warnings; separate planner, domain, provider, guide, map and live-lifecycle modules; pinned tools and lockfile | Further decomposition can follow feature changes; independent maintainability review |
| Security | Medium | 98/100 | Password hashing, role/ownership checks, session revocation, CSRF/origin/host checks, CSP and browser isolation headers, secret exclusion, transactional reservations, isolated public workspaces, bounded event-stream buffering | Independent security assessment and production-operational controls |
| Testing | Normal | 98/100 | 85 tests; 160 generated planning scenarios; 24 local intake fixtures; measured backend coverage and enforced minimums; Windows/Linux CI; verified public workflow | Successful live-provider semantic evaluation and real browser/device checks |
| Efficiency | Medium | 98/100 | No runtime npm dependencies; bounded planning/storage; live SSE with slow-consumer limits; conditional static requests avoid repeat payloads; 100-request public exercise across five sessions | Peak-capacity/endurance and successful provider-latency measurement |
| Accessibility | Normal | 98/100 | Scoped axe across 50 role/page combinations plus an offer form; source-measured marker contrast; text map alternative; labels, skip link, reduced motion and page-heading focus | Rendered contrast, native dialogs/keyboard, mobile and screen-reader validation |
| Problem alignment | High | 98/100 | Dynamic food-rescue assistance, context-aware constraints, role-specific workflow, explanations, disruption preview, receipt-based outcome accounting | Confirm an approved food-rescue vertical if required; actual coordinator feedback |

## Measured results, separate from judge scores

- `npm run lint`: zero errors and warnings. The lint rules check correctness and unsafe language features; they do not prove the absence of defects.
- `npm run test:coverage`: see [recorded coverage](verification/coverage.json). CI enforces at least 95% lines, 90% branches and 90% functions for `lib/*.mjs` and `server.mjs`. These are code-execution measurements, not category scores.
- `npm run evaluate`: 24/24 fixed deterministic intake fixtures. This is not an unrestricted-language accuracy estimate.
- `npm run check:contrast`: the three map-marker label pairs meet 4.5:1 using their opaque source colours. jsdom's axe checks exclude contrast.
- [Public deployment verification](verification/public-deployment.json): health, assets/CSP, secure cookies, origin rejection, previews, reservation confirmation, visitor isolation and cleanup passed.
- [Recorded public HTTP exercise](verification/public-http-load.json): 100 requests, five independent sessions, unchanged state. State-read p95 was 295.42 ms and preview p95 106.41 ms in that warm-service run. This does not establish production capacity or global latency.
- Dependency audit reports no known vulnerabilities at verification time; it is not a security audit.

## What prevents an honest claim of six achieved 98s

Gemini 3.8 Flash is configured, but generation attempts returned 503/high demand or timed out. Local fallback passed; it does not count as live-model success. No connected browser, assistive-technology review, independent security assessment, or food-rescue coordinator pilot has been recorded. The owner's four general requirements are mapped in [READINESS.md](READINESS.md); any event-specific approved vertical must still be confirmed.

The earlier internal point estimates were a provisional checklist and were not calibrated to the competition. This document replaces those estimates with the requested six targets and verifiable evidence. It does not assign a fabricated competition total.
