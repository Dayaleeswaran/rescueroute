# Verification and practical limits

Run:

```sh
npm ci
npm test
npm run check
npm run evaluate
npm run benchmark
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

The recorded suite has 67 passing tests, including 24 fixed local intake fixtures and 160 generated planning scenarios. Provider tests use controlled mocks. A separate running-app smoke request with configured credentials returned model-unavailable and correctly used local fallback; successful live extraction remains unverified. A UI integration test verifies that a rejected key produces visible local fallback, preserves the extracted fields, and leaves donor confirmation unchecked.

axe-core checks WCAG 2 A/AA and 2.1 A/AA rules on the admin overview, network, settings, and offer form in jsdom: zero reported violations in those checks. Colour contrast is explicitly excluded because jsdom has no layout renderer. This does not establish WCAG conformance, screen-reader usability, or keyboard behaviour in an actual browser.

[Recorded CPU benchmarks](verification/benchmark.json) contain local percentiles and workload sizes. They measure neither HTTP/cloud latency nor Gemini response time. Re-run `npm run benchmark` on the evaluation machine; do not interpret CPU results as end-to-end speed guarantees.

The pinned GitHub Actions workflow runs syntax, tests, fixtures, and benchmarks on Windows and Linux. A committed workflow is not evidence that a hosted run has passed; inspect its actual run before claiming CI success.
