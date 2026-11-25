# Submission readiness and requirement evidence

This document maps the four general expectations supplied by the owner to working food-rescue behaviour. It is not an official competition score or independent confirmation of an approved vertical. The earlier urban-air problem statement describes a different task.

| Supplied expectation | RescueRoute implementation | Evidence |
| --- | --- | --- |
| Smart, dynamic assistant | Donation extraction, clarification questions, source facts, and labelled offline fallback | 24 deterministic fixtures; mocked provider tests; actual provider failures recorded |
| Decisions based on user context | Approved supply, recipient exclusions, chilled capability, time windows, volunteer schedules, prior reservations, and disruption comparison | 160 generated planning scenarios; 80-to-60 preview; conservation and independent feasibility checks |
| Practical real-world usability | Role-specific guided rescue, review, reservations, ordered handoffs, and recipient receipts | Domain/HTTP/DOM workflow checks; real coordinator pilot and device review still pending |
| Clean, maintainable code | Backend responsibility separation, strict extraction contract, pure planner, independent audit, dedicated preview/guide modules, lockfile and CI | Syntax checks; Windows/Linux workflow; further frontend decomposition remains worthwhile |

## Verified in this checkout

- 81 automated tests pass.
- Scoped axe checks pass across 50 role/navigation combinations and an offer form; colour contrast is excluded from jsdom checks.
- Targeted map-marker text colour ratios pass 4.5:1, using source CSS values only.
- Local HTTP exercise: 100 requests with five concurrent workers and unchanged operational state.
- Public deployment verified at https://rescueroute-demo.onrender.com: health, assets/CSP, secure cookies, origin rejection, disruption preview, reservations, visitor isolation, and cleanup passed. See `verification/public-deployment.json`.
- Public HTTPS workload: 100 requests across five independent visitor sessions passed; p95 state reads 295.42 ms and previews 106.41 ms in one warm-service run. See `verification/public-http-load.json`.
- The prior published commit's Windows and Linux CI checks passed. Inspect the latest run before claiming the latest commit passed.

## Still incomplete

- **Live Gemini extraction:** 3.8 Flash is configured; the latest evaluation again used local fallback after provider unavailability. Zero live passes are recorded. Provider outages cannot be fixed by changing a test result.
- **Deployment limits:** the public URL and basic isolation/workflow checks are verified. Long-running availability, peak capacity, cold starts, real devices, and production operations are outside those checks.
- **Rendered usability/accessibility:** no browser is connected. Mobile layout, native dialog/keyboard behaviour, rendered contrast, and assistive-technology checks remain unverified.
- **Real user validation:** no food-rescue coordinator pilot has been recorded. Use `PILOT_CHECKLIST.md`.
- **Challenge eligibility:** these four expectations are general. If the event restricts submissions to specified verticals, confirm food rescue is allowed before using a submission attempt.

These gaps remain visible rather than being converted into a fabricated score or a claim of full readiness.

## Six-criterion improvement pass

The six requested categories each have a 98/100 target in `EVALUATION.md`; no attained judge scores are claimed. The project now enforces lint and backend coverage gates, separates live/GPS lifecycle code, bounds slow event-stream clients, validates static caches while preserving private no-store responses, and moves DOM focus to the new page heading on navigation. The security boundary review is in `SECURITY.md`.
