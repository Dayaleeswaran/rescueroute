# RescueRoute

**Every meal has somewhere to go.** A food-rescue coordination assistant that turns donor messages into reviewed offers and feasible collection-and-delivery plans.

Chosen vertical: **sustainability and community logistics**. Primary persona: a coordinator working with restaurants, community recipients, and volunteer drivers.

## The problem

Food-rescue coordinators must reconcile changing quantities, short collection windows, dietary restrictions, limited transport, and cancellations. A list of donations is useful only when someone can actually collect and deliver them.

The [UNEP Food Waste Index 2024](https://www.unep.org/resources/publication/food-waste-index-report-2024) estimates 1.05 billion tonnes of food waste in 2022 across households, retail, and food services. RescueRoute addresses one operational part of that problem: coordinating the collection of **donor-confirmed surplus meals**. Its demo results are simulated allocations, not evidence of real meals delivered or emissions avoided.

## Run locally

Requires **Node.js 22.13 or newer**. There are no package dependencies, installs, databases, external fonts, or map services.

```sh
npm start
```

Open **http://localhost:3000**. The server listens only on `127.0.0.1`. On Windows, use `npm.cmd start` if PowerShell blocks `npm.ps1`.

```sh
npm test
npm run check
```

## Two-minute demonstration

1. Click **Build rescue plan**. The initial scenario allocates **80 meals**, respecting the declared constraints.
2. Read the trip times and explanations. The map is an illustrative city grid; the trip list is the textual equivalent.
3. Click **Simulate Alex cancelling**. The plan rebuilds automatically. Alex's chilled vehicle is removed, so the 20 chilled meals remain unallocated. Other constraints can leave additional food unmatched.
4. Restore Alex and see the allocation recover.
5. Click **Add food offer → Use sample message → Extract offer details**. Review the draft, choose a collection location, and confirm the donor-provided details. Add the offer and rebuild.
6. **Confirm this plan**, then **Export plan** to download a JSON record containing the scenario, decisions, assumptions, and feasibility audit.

Confirmation records human review within the current browser session. It does not notify organisations, reserve inventory in a shared database, or dispatch drivers. Refreshing resets the demo.

## How the assistant works

```text
Donor message
    ↓
AI structured extraction / explicitly labelled local parser
    ↓
Unknown-field questions + coordinator review
    ↓
Validated, donor-confirmed food offer
    ↓
Deterministic allocation engine → independent feasibility audit
    ↓
Explainable draft trips → coordinator confirmation → export
```

### Prompt design

The actual system prompt is exported as `INTAKE_PROMPT` in [lib/intake.mjs](lib/intake.mjs). It defines the coordinator persona, treats messages as untrusted data, requires unknown values to remain `null`, prohibits inferred allergens and food-safety certification, and delegates final review to a human. OpenAI structured output constrains the draft's shape. Server validation then checks its contents. Structured output does **not** guarantee factual correctness.

Follow-up questions are generated from missing fields rather than guessed answers. Example: “15 meals available” provides a quantity, but not a location, declared allergens, transport requirement, or collection deadline. The coordinator must supply those before adding the offer. The AI has no allocation tools or access to the server API key in its prompt.

### Optional live AI intake

The planning demo works without credentials. Without a key, **Local intake** is shown in the interface. The limited parser recognises meal counts, explicit collection times, and labelled `Donor:`, `Food:`, `Handling:`, and `Allergens:` fields. It is not presented as an LLM.

To enable live extraction, copy `.env.example` to `.env`, set `OPENAI_API_KEY`, and restart `npm start`. `OPENAI_MODEL` defaults to `gpt-4.1-mini`; choose an available model that supports Chat Completions structured output. Only submitted donor-message text goes to OpenAI. Use fictional data for this demonstration. API usage may incur provider charges. Keys remain server-side and `.env` is excluded from Git.

The adapter uses the [official structured-output format](https://developers.openai.com/api/docs/guides/structured-outputs). Provider errors are surfaced; the app does not silently relabel local parsing as AI. The live provider has not been exercised without user-supplied credentials; automated tests use a mocked provider response.

### Allocation decisions

For each donor–recipient–volunteer combination, the engine checks:

- Donor-confirmed food and positive remaining stock and demand.
- No declared allergen conflicts, with case-insensitive comparison.
- Chilled transport capability when required.
- Travel from the driver's previous delivery, offer readiness, and four minutes for collection.
- Collection completion before the donor deadline.
- Travel and four-minute handover before both the recipient deadline and driver shift end.
- A load no larger than the vehicle capacity, remaining stock, or remaining demand.

Among feasible trips, a reproducible heuristic favours closing deadlines, recipient priority, fuller loads, and shorter travel, with a penalty for using chilled vehicles on ambient offers when chilled supply exists. After choosing a trip, it updates stock, demand, driver position, and availability before choosing the next.

The score is `1200 / (deadline - planningStart + 10) + priority × 9 + meals × 0.7 - kilometres × 0.8 - chilledOpportunityCost`. The opportunity cost is 15 when applicable. Deadline urgency uses a common start time so a later-arriving driver is not rewarded for being late.

This is a **greedy heuristic, not a global optimiser**. It does not claim that unmatched meals are impossible to deliver under every alternative plan. The independent audit directly checks constraints without reusing the scoring/candidate function.

## Architecture and maintainability

| File                 | Responsibility                                                                    |
| -------------------- | --------------------------------------------------------------------------------- |
| `server.mjs`         | Local HTTP server, explicit static-file allowlist, request boundaries, API routes |
| `lib/scenario.mjs`   | Fictional, reproducible scenario factory                                          |
| `lib/validation.mjs` | Shared input contracts and limits                                                 |
| `lib/intake.mjs`     | Prompt, provider adapter, output cleaning, local parser, follow-up questions      |
| `lib/planner.mjs`    | Pure planning function and separate feasibility audit                             |
| `public/app.js`      | UI state, reviewed intake, replanning, confirmation, export                       |
| `public/styles.css`  | Responsive layout, keyboard focus, reduced-motion support                         |
| `test/`              | Planner, intake, and HTTP integration tests using Node's test runner              |
| `docs/`              | Prompt evaluation cases and the judging demonstration guide                       |

## Security and efficiency

- Server-side API key; no secret sent to the browser, logged, or committed.
- Local-only listener, hostname restrictions, same-origin checks, and no permissive CORS.
- Strict JSON request boundaries: 48 KB body limit, bounded input fields, maximum 30 entities per category.
- Explicit static-file allowlist excludes source files, `.env`, and repository internals.
- Content Security Policy, no inline scripts, text escaping, and no external runtime assets.
- Intake message limit of 3,000 characters, a 20-second provider timeout, limited output length, and one intake request at a time with a cooldown.
- Pure, repeatable planning; bounded to 240 greedy iterations. Worst-case complexity is `O(iterations × offers × recipients × volunteers)`. This is intended for small coordinator workloads, not citywide optimisation.
- No telemetry, background polling, or paid map API. Data is held in memory and resets on refresh. Downloaded exports contain the scenario and should be handled appropriately.

## Tests and validation

The suite covers full baseline allocation; cancellation; no volunteers; expired and unconfirmed food; allergen exclusion; capacity and demand limits; duplicate/tampered trips; input validation; explicit and missing intake facts; mocked live extraction; provider failure; cross-origin rejection; file exposure; request limits; and intake throttling.

A deterministic generator also exercises **160 varied scenarios**, checking feasibility, stock conservation, demand conservation, and reproducibility. See [docs/PROMPT_EVALUATION.md](docs/PROMPT_EVALUATION.md) for semantic prompt cases that require a configured live model. Mocked provider tests do not establish live model quality.

Keyboard support includes labelled fields, native form controls, modal dialogs, visible focus, a skip link, semantic landmarks, live feedback, and a textual route list. The responsive layout includes a narrow-screen navigation treatment and honours reduced-motion preferences. Full browser, screen-reader, and colour-contrast audits remain necessary before production use.

## Assumptions and practical limits

- Harbor City, its grid coordinates, all participants, and every quantity are fictional. The scenario clock starts at 16:00; all deadlines are the same day.
- Distances are straight lines on a kilometre grid, at an assumed 24 km/h. They are **not road routes**, traffic estimates, or turn-by-turn navigation.
- Driver capacity is a meal-count limit per trip. Each trip collects from one donor and delivers to one recipient; subsequent trips begin at the previous recipient.
- A donor deadline governs collection completion; the recipient deadline governs delivery completion. This prototype has no separate food shelf-life, temperature sensor, or maximum transit-time model.
- Donors and coordinators must verify food suitability, ingredients, handling, and recipient requirements. A matching allergen list or chilled flag does not establish food safety or cold-chain compliance.
- Priority is an explicit demo setting (1–3); the system does not infer vulnerability from personal characteristics.
- Recipient needs and volunteer records are seeded demo data. The UI supports new food offers and Alex's cancellation/restoration, rather than full participant administration.
- Similar donor/food/deadline entries are blocked in the UI as possible duplicates; this is not comprehensive duplicate detection.
- No authentication, shared persistence, messaging, dispatch, food-safety certification, or legal compliance claims. Add identity, consent, validated operational policies, real routing, audit storage, and concurrency-safe reservations before use with real organisations.

## Challenge submission

The source has no dependency or build directories and is comfortably below 10 MB. Keep `.env`, generated artefacts, and `node_modules` excluded. Use one branch (`main`) and a public GitHub repository. The repository should include this README, complete source, tests, and prompt evaluation documentation. A public remote and public visibility must be verified before submitting; a local Git repository alone is not a completed submission.

Demo script: [docs/DEMO.md](docs/DEMO.md).
