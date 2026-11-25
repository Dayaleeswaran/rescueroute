# Verification and practical limits

Run:

```sh
npm ci
npm run test:coverage
npm run lint
npm run check
npm run evaluate
npm run benchmark
npm run load-check
npm run check:contrast
npm audit
```

`npm start` needs no runtime packages. `npm ci` installs the pinned development dependency tree for jsdom tests.

## Automated layers

- **Planner tests:** baseline, cancellation, no volunteers, expiry, unconfirmed food, allergen equivalences, donor transit limits, capacity, demand, and tampered assignments. A deterministic generator exercises 160 varied scenarios, asserting feasible schedules and conservation of stock and demand.
- **Domain tests:** reservations, concurrent confirmation, stale drafts, donor/recipient ownership, review permissions, source locks, pickup ordering, handoffs, receipt-only delivery counts, release/cancellation, administrator protection, and simulation clock constraints.
- **HTTP tests:** authentication, CSRF, origin and hostname boundaries, allowed methods, role gates, body limits, secret-file exclusion, provider throttling, password-session revocation, and guarded reset.
- **Persistence tests:** serialised writes, rollback, and reading the committed state through a new Database instance.
- **DOM integration tests:** the actual interface script runs in jsdom against a real ephemeral HTTP server. Tests navigate every admin panel, create a donor, submit/approve an offer, build/confirm a plan, switch participant accounts, complete a handoff, and check untrusted text handling and local intake.
- **Syntax checks:** every JavaScript module in the app, tests, and scripts.

DOM tests stub dialog methods, scroll behaviour, and cookie transport. They do not run an actual browser renderer. Browser visual, native-dialog focus, mobile, screen-reader, and full contrast reviews remain outstanding because no browser connection was available in the implementation session.

## Manual review checklist

1. Inspect the sign-in page and every admin panel at desktop and 390 px width.
2. Navigate with keyboard only; inspect dialog focus, Escape, validation messages, skip link, and focus return.
3. Complete the cross-role demo in `DEMO.md` and refresh between account changes.
4. Try changing a reserved offer and collecting a later trip before the first is received; both must be rejected.
5. Cancel a volunteer before pickup, then attempt cancellation after pickup. Only the first is permitted.
6. Confirm the same draft from two isolated sessions. One confirmation must fail.
7. Restart the server and sign in again; operational records should persist while sessions reset.
8. Export JSON/CSV and verify reserved and delivered quantities are separate and no password hashes are present.
9. Test optional live AI only after configuring a server key; execute the semantic cases in `PROMPT_EVALUATION.md`.

No automated test establishes actual food safety, real-world dispatch, or a globally optimal route. Those are outside the demo's claims.

## Live map checks

The suite also covers geographic distances, role-filtered location visibility, expiring GPS fixes, labelled demo isolation, authenticated SSE, click-through map details, and stopping an in-flight GPS update. Tile rendering, Leaflet interaction in a renderer, and real device permissions remain manual checks; DOM tests exercise the map list and controls with the renderer unavailable.

## Gemini, accessibility, and measured performance

The recorded suite has 85 passing tests, including 24 fixed local intake fixtures and 160 generated planning scenarios. Provider tests use controlled mocks. Gemini 3.8 generation verification returned HTTP 503/high demand and correctly used local fallback; successful live extraction remains unverified. A UI integration test verifies that a rejected key produces visible local fallback, preserves the extracted fields, and leaves donor confirmation unchecked.

axe-core checks selected WCAG 2 A/AA and 2.1 A/AA rules across 50 role/navigation combinations (16 admin, 14 coordinator, 7 donor, 7 recipient, 6 volunteer) and the admin offer form in jsdom: zero reported violations in those checks. Colour contrast is explicitly excluded because jsdom has no layout renderer. This does not establish WCAG conformance, screen-reader usability, or keyboard behaviour in an actual browser.

[Recorded CPU benchmarks](verification/benchmark.json) contain local percentiles and workload sizes. They measure neither HTTP/cloud latency nor Gemini response time. Re-run `npm run benchmark` on the evaluation machine; do not interpret CPU results as end-to-end speed guarantees.

The pinned GitHub Actions workflow runs syntax, tests, fixtures, and benchmarks on Windows and Linux. A committed workflow is not evidence that a hosted run has passed; inspect its actual run before claiming CI success.

## Guided rescue and disruption comparison

Domain, HTTP, and DOM checks verify the fresh-seed 80-to-60 comparison, no database/revision changes, preserved confirmed reservations, stale comparisons, manager-only access, CSRF, and role-specific workflow links. Guide and planner controls are included in the scoped axe check. Colour contrast and native browser behaviour remain unverified.

`npm run load-check` runs five concurrent workers through 50 authenticated state reads and 50 read-only comparisons on a local ephemeral server, then verifies unchanged revision, reservations, and plan history. [Recorded results](verification/http-load.json) describe that local single-session exercise, not multi-user cloud performance.

`npm run evaluate:live` explicitly makes up to three synthetic-message provider calls when a key is configured. It exits unsuccessfully if any case falls back or differs from its expected fields. Circuit-paused cases are marked unattempted. Normal CI and startup never run this optional paid-provider evaluation.

## Expanded readiness checks

All navigation pages for the five roles are now covered by the scoped semantic accessibility check. A regression verifies that changing from an administrator account to a participant leaves administrator-only views. This complements server-side role enforcement.

`npm run check:contrast` measures the three opaque map-marker foreground/background pairs from the actual stylesheet. The donor label background was darkened; measured ratios are donor 6.29:1, recipient 5.94:1, and volunteer 4.96:1. These targeted source checks do not replace a browser contrast audit. See `verification/marker-contrast.json`.

`npm run verify:deployment -- https://YOUR-SERVICE.onrender.com` exercises the owner's disposable public evaluation service after publication. Its local regression uses real HTTP requests with an emulated HTTPS proxy Host header; that test does not verify TLS termination or external hosting. An external run now passes at https://rescueroute-demo.onrender.com; see `verification/public-deployment.json`.

## Recorded public-service exercise

`npm run load:public-demo -- https://rescueroute-demo.onrender.com` performs a fixed 100-request exercise across five independent visitor workspaces, verifies unchanged operational state, and resets its own test workspaces. It refuses non-public-demo mode and makes no Gemini requests. This is a small owner-authorised exercise, not a peak-capacity or endurance test. Do not run it against another person's service.

[Recorded public results](verification/public-http-load.json): 50 state reads (p95 295.42 ms) and 50 disruption previews (p95 106.41 ms), five concurrent sessions, no state changes. Authentication, cold starts, browser rendering, and cleanup are excluded from the percentiles. The separate deployment verifier checks cross-visitor reservation isolation.

## Enforced quality gates

`npm run lint` applies the pinned ESLint recommended rules plus strict equality and bans on dynamic code execution to authored application/test/script modules. Vendored Leaflet and ignored artefacts are excluded. Only the jsdom UI/motion test harnesses may evaluate the actual interface source for testing.

`npm run test:coverage` instruments backend modules and the server. Minimums are 95% line, 90% branch, and 90% function coverage; CI runs that same command on Windows and Linux. See `verification/coverage.json` for actual measurements. Coverage is not a judge score.

Regressions cover SSE backpressure and broken sockets, conditional public-asset requests, private `no-store` responses, browser isolation headers, and page-heading DOM focus after navigation. Live updates and GPS now live in `public/rescue-live.js`; existing handoff, map, GPS-consent and stop-in-flight tests exercise that extracted module. Native browser behaviour remains a separate review.

## Optional motion

Three focused motion tests verify device reduced-motion changes, user preference/cancellation, form usability, and unsupported APIs. A DOM workflow test verifies that a refresh does not replay the current view's entrance. These tests use controlled animation handles and do not verify visual playback or native animation timing. See `MOTION.md`.
