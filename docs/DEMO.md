# Judging demonstration

## Opening: 15 seconds

“A donation is only useful when someone can collect and deliver it in time. RescueRoute helps a coordinator turn surplus offers, recipient needs, and volunteer availability into a checked delivery plan.”

## Baseline: 30 seconds

Start with a reset demo. Point out 80 meals, two recipient organisations, and two volunteers. Build the plan. Explain the collection deadline, recipient allergen exclusions, chilled transport, driver capacity, and sequential trips. Show an explanation under one trip.

## Disruption: 30 seconds

Simulate Alex cancelling. Explain that the system removes the vehicle and rebuilds its proposal. The chilled meals remain unmatched because no active chilled vehicle exists. The app reports the shortage rather than inventing transport or hiding it.

Restore Alex. Demonstrate the plan recovering.

## Prompt interaction: 30 seconds

Add an offer. Use the sample message and extract its fields. State whether live AI or the local parser is enabled. Show that missing information is requested and the location is not invented. Confirm the donor details, add the offer, and rebuild.

## Evidence: 15 seconds

Confirm and export the plan. Show the source structure, the actual intake prompt, and `npm test`. Explain that 160 generated scenarios check conservation and feasibility, while separate prompt-evaluation cases assess extraction and missing facts.

## Honest scope

This is a fictional-city prototype with straight-line distances and donor-declared handling requirements. No real delivery was dispatched. It uses a heuristic, not guaranteed global optimisation. Real deployment needs trusted partners, validated handling policies, road routing, authentication, and shared inventory reservations.
