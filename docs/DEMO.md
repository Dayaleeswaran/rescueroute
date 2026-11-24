# Judging demonstration: complete role workflow

## Before presenting

Run `npm start`, then open http://localhost:3000. Use seeded credentials from the README. For a clean network, an administrator can export records and use Settings → Reset demo, entering their password and `RESET DEMO`. Reset signs every session out.

The demonstration uses fictional records, a fixed simulation clock, and local persistence. Without an API key, the message extractor is visibly labelled **Local parser**. Do not call it a live AI model.

## 1. Problem and working panels

“A donation is useful only if someone can collect and deliver it in time. RescueRoute connects donor offers, recipient needs, and volunteer capacity while checking the constraints behind each trip.”

Show the admin overview, profiles, approval queue, user accounts, reports, and audit panel. Explain that donors, recipients, and volunteers have smaller portals with server-enforced ownership.

## 2. Dynamic planning

Open Rescue planner. Build a draft: 80 meals, four trips. Inspect the declared allergen requirements, pickup cutoff, chilled transport, and driver sequence. The draft reserves nothing.

Make Alex unavailable in Volunteers. Build a new draft. Show 60 meals allocated and 20 chilled meals unallocated. Restore Alex and rebuild to recover all 80 meals.

Confirm the latest draft. Build another draft and show that those meals cannot be allocated twice: the first confirmed plan already reserves them.

## 3. Complete the handoff

Sign out, then sign in as `volunteer@demo.rescueroute.test` (Maya). Open Deliveries and use the earliest pickup:

1. Accept assignment.
2. Confirm pickup.
3. Mark arrival and request receipt.

Show that Maya cannot count the meals as received. Sign out and use `riverside@demo.rescueroute.test` to confirm receipt. Then sign in as admin and inspect delivered totals and the recorded event history.

Separate ordinary tabs share a login cookie. Use sign-out/role switching or isolated browser profiles rather than assuming each tab has a different account.

## 4. Intake and approval

As a donor, create an offer from the sample message. Point out missing facts and the donor-confirmation checkbox. Submit it to review. As a coordinator, approve the record and include its unreserved quantity in the next draft.

If live AI is configured, explain its prompt restrictions and structured output. If not, clearly identify the limited parser and show where the actual live adapter and prompt are implemented.

## 5. Evidence and practical limits

Show `npm test`, source separation, input validation, and exports. Explain that meals are counted as delivered only after recipient/coordinator receipt. Export the report.

Close by stating the operational boundaries: fictional city, straight-line distances, fixed planning clock, donor-declared safety requirements, single-process persistence, and no real dispatch. No global optimality, emissions reduction, or real-world delivery claim is made.
