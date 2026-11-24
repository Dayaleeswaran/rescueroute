# RescueRoute

**Every meal has somewhere to go.** A complete local food-rescue coordination demo with authenticated role portals, persistent records, approval queues, constraint-checked plans, inventory reservations, and a delivery handoff workflow.

**Vertical:** sustainability and community logistics. **Primary persona:** a coordinator connecting food donors, community recipients, and volunteer drivers.

## Start the demo

Requires **Node.js 22.13 or newer**.

```sh
npm start
```

Open **http://localhost:3000**. No dependency installation is required to run the application: the server uses Node built-ins and the interface uses native browser APIs. On Windows, use `npm.cmd start` if PowerShell blocks `npm.ps1`.

The application is deliberately local-only. It binds to `127.0.0.1`, rejects non-local hostnames, and creates an ignored `.data/rescueroute.json` file. Run **one server process per data directory**. The server does not dispatch real deliveries or send external messages.

### Demo accounts

Use **Use selected demo account** on the sign-in screen, then sign in. Every seeded account uses this public demonstration password:

```text
RescueDemo!2026
```

| Role          | Email                               | Access                                                     |
| ------------- | ----------------------------------- | ---------------------------------------------------------- |
| Administrator | `admin@demo.rescueroute.test`       | All operational panels, users, settings, reset             |
| Coordinator   | `coordinator@demo.rescueroute.test` | Network management, reviews, planning, deliveries, reports |
| Donor         | `donor@demo.rescueroute.test`       | The Green Table's profile, offers, relevant deliveries     |
| Donor         | `bakery@demo.rescueroute.test`      | Daily Bread Bakery                                         |
| Donor         | `roots@demo.rescueroute.test`       | Roots Kitchen                                              |
| Recipient     | `recipient@demo.rescueroute.test`   | Northside Shelter's profile, needs, receipts               |
| Recipient     | `riverside@demo.rescueroute.test`   | Riverside Centre's profile, needs, receipts                |
| Volunteer     | `volunteer@demo.rescueroute.test`   | Maya Chen's profile, availability, assigned trips          |
| Volunteer     | `alex@demo.rescueroute.test`        | Alex Morgan's profile, availability, assigned trips        |

These credentials are intentionally public for local evaluation. Do not expose the demo to the internet or reuse its passwords. Accounts can be created, disabled, and given replacement passwords from the admin panel. A password reset revokes that account's existing sessions. Administrators cannot disable their own account.

## Why this problem matters

The [UNEP Food Waste Index 2024](https://www.unep.org/resources/publication/food-waste-index-report-2024) estimates 1.05 billion tonnes of food waste in 2022 across households, retail, and food services. RescueRoute addresses one operational slice: matching **donor-confirmed surplus meals** with recipient needs when time, ingredients, transport, and staffing are constrained.

A donation is only useful when it can actually be collected and delivered. RescueRoute does not treat an attractive route diagram or an AI suggestion as a substitute for feasible logistics.

## Working panels

| Panel                      | Functionality                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Overview                   | Role-specific metrics, fictional network map, actionable links, recent notifications                           |
| Food offers                | Create, edit, withdraw, search, filter, review status, declared allergens, handling, use-by and transit limits |
| Recipient needs            | Create, edit, withdraw, search, filter, priority, exclusions, delivery deadline                                |
| Donor & recipient networks | Organisation profiles, contacts, grid locations, activation/deactivation                                       |
| Volunteers                 | Profiles, capacity, vehicle, chilled capability, shifts, availability and cancellation                         |
| Review queue               | Approve or reject submissions with an optional review note                                                     |
| Rescue planner             | Build drafts, see unmet needs and explanations, confirm reservations, inspect persisted history                |
| Deliveries                 | Assignment acceptance, pickup, arrival, recipient receipt, recorded event timeline                             |
| Impact & reports           | Offered, reserved, and received quantities separately; JSON and donor CSV export                               |
| Notifications              | Persisted, role- and profile-filtered updates                                                                  |
| Activity log               | Latest 200 actions, with actor, time, and details                                                              |
| User accounts              | Admin-only account creation, account status, email/name updates, password resets                               |
| Settings                   | Admin-only network naming, forward-only simulation clock, provider status, guarded reset                       |

Permissions are enforced by the server, including record ownership and field whitelists. Hiding a navigation item is not the security boundary. Participant accounts only receive their own records and information relevant to assigned handoffs. User password hashes and provider keys never appear in API state or exports.

## Complete demonstration

1. Sign in as **admin**. In **Rescue planner**, build a draft. The initial scenario proposes **80 meals across four trips**. Read the collection times and explanations.
2. Before confirmation, open **Volunteers**, make Alex unavailable, and build a new draft. Only **60 meals** can be allocated; the chilled meals have no eligible vehicle.
3. Restore Alex, rebuild, then **Confirm & reserve meals**. Reservations now protect the stock, demand, and driver schedule.
4. Build another draft. Already reserved meals cannot be allocated again.
5. Sign out and sign in as **volunteer** (Maya). In **Deliveries**, accept the first trip, confirm pickup, then mark arrival. Trying to collect a later trip first is rejected.
6. Sign out and sign in as **riverside**. Confirm receipt of Maya's delivery. Only now are those meals counted as delivered.
7. Sign back in as admin. Inspect the received totals, activity log, and exports.
8. As a donor, create a new offer. It enters review. A coordinator can approve it and include its remaining quantity in a new plan.

Accounts in ordinary tabs share the same browser cookie. Sign out to switch roles, or use separate browser profiles for simultaneous sessions. Refresh each workspace after another account changes the network. The interface intentionally uses manual refresh rather than background polling.

See [docs/DEMO.md](docs/DEMO.md) for the judging script and [docs/API.md](docs/API.md) for permissions and endpoints.

## Decision logic and lifecycle

```text
Donor message → extracted draft → human review → pending offer
                                                ↓ coordinator approval
Approved supply + approved needs + available volunteers
                        ↓
Feasible draft → independent audit → coordinator confirmation
                                         ↓
                             stock and demand reserved
                                         ↓
Assigned → Accepted → Picked up → Awaiting receipt → Delivered
                                                       ↑
                                       recipient/coordinator confirms
```

### Allocation constraints

The pure planner considers only approved, donor-confirmed offers and approved needs at active organisations. It subtracts all confirmed reservations and all recipient-confirmed deliveries before planning. A new plan therefore operates on residual quantities.

Every trip checks:

- Positive remaining supply and demand; capacity limited to one driver load.
- No declared allergen conflict. Conservative equivalences cover milk/dairy, soy/soya, common nut labels, and several other synonyms. The broad nut group intentionally over-excludes. Unrecognised labels use normalised exact matching; this is not exhaustive allergen detection.
- Chilled transport when required by the donor.
- Travel from the driver's last committed delivery location, the offer's ready time, four minutes for collection, and collection completion before the donor cutoff.
- Four-minute delivery handover before the recipient deadline, donor-declared delivery use-by, and driver shift end.
- Transit plus delivery handover within the donor-declared maximum transit minutes.

Feasible trips receive a repeatable heuristic score based on soon-closing supply, recipient priority, load size, travel distance, and preserving chilled transport. Quantities and driver positions are updated after each selection. The independent audit directly rechecks constraints without calling the candidate/scoring function.

This is a **greedy heuristic, not a guarantee of global optimality**. An unmatched offer is not proof that no alternative schedule could deliver it.

### Reservation and delivery integrity

- Drafts reserve nothing. Confirmation rechecks the current network and commits the assignments atomically.
- A global revision rejects stale drafts and edits; concurrent confirmation requests cannot both reserve the same stock.
- Transactions are serialised within one server process. A failed transaction leaves both in-memory state and the committed data file unchanged.
- Reserved source records and linked organisation locations cannot be edited while the trips are active.
- Subsequent drafts account for committed driver schedules, including their last delivery position.
- Only the assigned volunteer or a coordinator can accept, collect, or mark arrival. Only the receiving organisation or a coordinator can confirm receipt.
- The next pickup cannot occur while an earlier non-cancelled trip for that driver is incomplete.
- A volunteer cancellation releases that driver's uncollected assignments. A volunteer carrying food cannot become unavailable until the handoff is completed.
- The coordinator's global release cancels all uncollected trips while preserving food in transit and completed receipts. Cancelling all dependent uncollected stops prevents new routes relying on a removed stop.
- Historical trip labels and contacts are snapshotted, while delivered quantities remain conserved even if a source profile changes later.
- Source quantities cannot be reduced below portions already delivered or reserved. Linked history cannot be deleted; use deactivation/cancellation instead.

## Prompt design and no-key mode

The actual system prompt lives in [lib/intake.mjs](lib/intake.mjs). It defines a donation-intake assistant, treats user messages as untrusted data, requires unknown facts to remain `null`, forbids inferred allergens and safety certification, and returns a constrained structured draft. Missing fields generate follow-up questions. AI cannot approve an offer, allocate stock, or perform delivery transitions.

**The default demo has no API key.** Its interface explicitly says **Local parser**. It recognises explicit meal quantities and collection times and labelled `Donor:`, `Food:`, `Handling:`, and `Allergens:` lines. The quantity, food description, deadline, handling, and allergens can populate the form; the coordinator must still confirm the organisation, donor suitability, location, use-by, and transit requirements. This parser is not presented as an LLM.

Optional live mode: copy `.env.example` to `.env`, set `OPENAI_API_KEY`, choose an available structured-output-capable model with `OPENAI_MODEL`, and restart. Only submitted message text goes to OpenAI. Keys remain server-side. Provider failures are surfaced rather than silently replaced with local output. API usage may incur charges.

The adapter uses the [official structured-output format](https://developers.openai.com/api/docs/guides/structured-outputs). Structured output guarantees shape, not truth. Live provider behaviour has not been verified without credentials; its transport is covered by mocked tests. See [docs/PROMPT_EVALUATION.md](docs/PROMPT_EVALUATION.md).

## Test and check

The only package dependencies are development tools for DOM integration tests:

```sh
npm ci
npm test
npm run check
npm audit
```

Tests cover allocation constraints; 160 deterministic generated scenarios; conservation and reproducibility; double reservation; concurrent confirmation; stale drafts; ownership; review rules; transport cancellation; ordered handoffs; recipient-only receipt; account permissions; password-session revocation; guarded reset; persistent restart; rollback; request size; authentication; CSRF; origin checks; file exposure; and the interface event flows against the real HTTP server.

The jsdom tests are **DOM integration tests, not visual browser tests**. Native dialog methods are stubbed for that environment. They do not establish layout correctness, native dialog focus behaviour, screen-reader behaviour, or mobile rendering. A browser connection was unavailable during implementation, so those reviews remain outstanding. See [docs/TESTING.md](docs/TESTING.md).

## Architecture

| Module               | Responsibility                                                                    |
| -------------------- | --------------------------------------------------------------------------------- |
| `server.mjs`         | Local HTTP server, sessions, CSRF/origin/host checks, API and static allowlists   |
| `lib/auth.mjs`       | Salted scrypt password hashes, constant-time comparison, expiring sessions        |
| `lib/database.mjs`   | Fictional seed data, atomic file replacement, serial transaction queue            |
| `lib/operations.mjs` | Roles, ownership, CRUD, approvals, reservations, lifecycle, audit, filtered views |
| `lib/planner.mjs`    | Pure allocation function and separate feasibility audit                           |
| `lib/allergens.mjs`  | Conservative label equivalences                                                   |
| `lib/validation.mjs` | Input limits and scenario contracts                                               |
| `lib/intake.mjs`     | System prompt, provider adapter, output cleaning, local parser                    |
| `public/`            | Accessible semantic controls, role-aware interface, responsive CSS                |
| `test/`              | Unit, domain, HTTP, persistence, and DOM integration tests                        |
| `scripts/check.mjs`  | Syntax check across every JavaScript module                                       |

## Security, efficiency, and accessibility

- HttpOnly, SameSite=Strict cookies; eight-hour in-memory sessions. Sessions reset on server restart. Password changes, account deactivation, and demo reset revoke relevant access; queued writes recheck account and demo generation.
- Scrypt password hashing with independent random salts; account fields are whitelisted.
- CSRF tokens for authenticated mutations, same-origin checks, local-host restrictions, strict CSP, escaped UI text, and static-file allowlists.
- Login throttling; intake cooldown, one provider request at a time, 3,000-character input limit, and a 20-second provider timeout. JSON bodies are limited to 48 KB.
- Maximum 30 records per operational category, 60 accounts, 200 plan versions, 1,500 audit entries, and 250 stored notifications. Older notifications/audit entries are bounded; exported state includes the latest 200 audit entries and 50 relevant notifications.
- No runtime dependencies, map API, external assets, telemetry, background polling, or bundling requirement. The bounded planner is intended for small coordinator workloads rather than global route optimisation.
- CSV exports quote cells and neutralise leading spreadsheet formula characters. JSON exports omit password hashes and API credentials, but include participant contacts and should be handled appropriately.
- Labelled form controls, semantic headings, native dialogs, status text in addition to colour, live feedback, visible focus, a skip link, responsive navigation, and reduced-motion support. The trip list is the textual map equivalent.

## Assumptions and deployment limits

All organisations, volunteers, addresses, and quantities are fictional. The simulation day is **25 November 2026**, starting at **16:00**. The clock is explicit and does not advance with real time. Event timestamps show when a demonstration action was recorded, not when a real delivery occurred.

Locations are kilometre-grid points. Travel is straight-line distance at 24 km/h; routes are **not road navigation, traffic estimates, or actual ETAs**. Driver availability after a committed trip uses its planned completion time. Each trip collects from one donor and delivers to one recipient. No multi-donor load or route optimiser is claimed.

Food suitability, declared ingredients, temperatures, deadlines, and vehicle capability are human-provided. The app cannot certify safety, independently verify a cold chain, identify undisclosed allergens, or replace local food-handling procedures. Conservative label matching and transit limits are planning checks, not a food-safety assessment.

The local JSON store is for a single-process demo. It is not a production multi-server database, backup service, or immutable audit ledger. Production use requires unique private credentials, HTTPS, durable database constraints and migrations, tested backup/recovery, real routing, verified food-handling policies, privacy review, and browser/accessibility testing. No payment system, external notifications, geolocation tracking, or actual dispatch is implemented.

## Challenge submission

Keep one branch (`main`) and a **public** GitHub repository. Commit the complete source, tests, lockfile, README, and prompt documentation. Exclude `.env`, `.data`, `node_modules`, and generated artefacts. The repository source is well under 10 MB; development packages are installed locally and are not committed.

Public repository: [Dayaleeswaran/rescueroute](https://github.com/Dayaleeswaran/rescueroute). The project is published on the single `main` branch. Verify visibility, branch count, source size, and a fresh-checkout test again before final submission.
