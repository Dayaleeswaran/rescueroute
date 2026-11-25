# Local HTTP API

All endpoints are same-origin. All operational routes require a session. All authenticated mutations require `X-CSRF-Token` and a JSON object with a `Content-Type: application/json` header. Tokens are returned by login/session endpoints. The HttpOnly cookie is managed by the browser.

## Session routes

| Method | Route          | Input / result                                                                    |
| ------ | -------------- | --------------------------------------------------------------------------------- |
| POST   | `/api/login`   | `{ email, password }` → public user, CSRF token, intake mode; sets session cookie |
| GET    | `/api/session` | Current public user, CSRF token, intake mode                                      |
| POST   | `/api/logout`  | `{}` → revoke current session                                                     |
| GET    | `/api/state`   | Server-filtered state for current role/profile                                    |

## Operational routes

| Method | Route                          | Permission                                         | Input                                                                    |
| ------ | ------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------ |
| POST   | `/api/entities/:kind`          | Managers, or owner for allowed records             | Explicit record fields and `revision`; optional `id` for edit            |
| DELETE | `/api/entities/:kind`          | Managers                                           | `id`, `revision`; only unlinked records                                  |
| POST   | `/api/review/offers`           | Managers                                           | `id`, `status`, optional `note`, `revision`                              |
| POST   | `/api/review/requests`         | Managers                                           | Same as above                                                            |
| POST   | `/api/plans/build`             | Managers                                           | `{}`; reads current server availability, not client-supplied allocations |
| POST   | `/api/plans/confirm`           | Managers                                           | Draft `id`, `revision`                                                   |
| POST   | `/api/plans/release`           | Managers                                           | `revision`; cancels all uncollected trips                                |
| POST   | `/api/trips/transition`        | Assigned volunteer / receiving recipient / manager | `planId`, trip `id`, next `status`, `revision`                           |
| POST   | `/api/volunteers/availability` | Volunteer owner or managers                        | Volunteer `id`, boolean `active`, `revision`                             |
| POST   | `/api/intake`                  | Donors or managers                                 | `{ message }` → unverified draft and follow-up questions                 |
| POST   | `/api/users`                   | Admin                                              | User `id` for edit or new account fields, `revision`                     |
| POST   | `/api/settings`                | Admin                                              | `networkName`, `city`, forward-only `now` in minutes, `revision`         |
| POST   | `/api/reset`                   | Admin                                              | `confirm: "RESET DEMO"`, current password; invalidates all sessions      |
| GET    | `/api/export`                  | Managers                                           | Filtered JSON report, public user fields only                            |

Kinds are `offers`, `requests`, `donors`, `recipients`, and `volunteers`. Managers are administrators and coordinators. Donors can create/edit their own offers and edit their profile; recipients can create/edit their own requests and edit their profile; volunteers can edit their profile. Only managers can create participant profiles. Role and account-profile links are fixed after account creation.

New/edited donor and recipient submissions become pending unless a manager explicitly reviews and approves the details. Donors cannot self-approve even if they submit approval fields. Ineligible records never enter the planner.

Owners and managers may also POST `/api/withdraw/offers` or `/api/withdraw/requests` with `id` and `revision`. Active reservations block withdrawal. Withdrawal preserves history and excludes the record from future plans.

## Delivery state machine

```text
assigned -> accepted -> picked_up -> awaiting_receipt -> delivered
```

Assigned/accepted trips can become cancelled through an availability change or the coordinator release operation. The API does not accept arbitrary status jumps. Delivered/cancelled trips are terminal. Only a recipient owner or manager can make `awaiting_receipt -> delivered`.

Mutations check the current user inside the serial transaction. Revisions protect against lost edits and stale plan confirmation. Password changes and reset generation changes revoke already-issued sessions, including requests queued for mutation.

## Errors

- `400`: invalid fields, quantities, or action prerequisites.
- `401`: missing, expired, revoked, or disabled session.
- `403`: wrong role, ownership, CSRF, origin, or hostname.
- `404`: unknown record/route.
- `405`: unsupported method.
- `409`: stale revision, reservation lock, duplicate confirmation, or invalid lifecycle transition.
- `429`: sign-in or intake throttle.
- `500`: unexpected server/storage failure; failed transaction changes are not committed.

The data store is not exposed as a static file. Export through the authenticated API; copying the local data file would include password hashes and should not be confused with a normal report export.

## Geographic map and tracking

`GET /api/events` supplies authenticated live invalidation events. `/api/state` includes role-filtered `mapData`. POST `/api/tracking/gps`, `/api/tracking/demo`, and `/api/tracking/stop` handle voluntary fixes and explicitly simulated movement. Profile writes accept optional `geo: [latitude, longitude]` and `locationLabel`; use null `geo` for an illustrative demo placement. Tracking does not change the planning revision. See [LIVE_MAP.md](LIVE_MAP.md) for the access rules, payloads, privacy, and deployment limits.

## Intake provenance and fallback

`POST /api/intake` returns `draft`, `mode` (`live` or `local`), `provider`, `configuredModel`, `actualModel`, `fallback`, `questions`, `warnings`, `evidence`, `graph`, `completeness`, `timings`, and an unapproved-draft `notice`. `fallback` contains a sanitised reason, whether a provider attempt occurred, and a display message. No API key or raw provider error is exposed. The graph contains extracted facts and source evidence, not private model reasoning.

Provider failures normally return a successful local draft with explicit fallback metadata; invalid user input still returns a client error. Server authentication, role checks, CSRF, cooldown, and concurrent-request controls still apply. A configured key indicates configuration only, not verified provider connectivity.

## Read-only disruption preview

`POST /api/plans/preview` requires a manager session, CSRF token, current `revision`, and an active `volunteerId`. It returns the baseline and alternative allocation summaries, unallocated reasons, unmet demand, allocation difference, excluded volunteer name/id, and the source revision. It compares future unreserved work with that volunteer excluded. Existing committed trips remain in place. The handler never enters a database write transaction, creates a plan, changes availability, releases reservations, or appends audit history. Stale input returns 409; participant access returns 403; invalid volunteer input returns 400. Both proposed plans pass the independent feasibility audit before being returned.
