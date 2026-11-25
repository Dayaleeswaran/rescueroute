/* Guided workflow and read-only decision comparison, independent of app state. */
(() => {
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function steps(data) {
    const role = data.user.role;
    const trips = data.plans
      .filter((p) => p.status === "confirmed")
      .flatMap((p) => p.assignments);
    const received = trips
      .filter((t) => t.status === "delivered")
      .reduce((n, t) => n + t.meals, 0);
    if (["admin", "coordinator"].includes(role)) {
      const pending = [...data.offers, ...data.requests].filter(
        (x) => x.status === "pending",
      ).length;
      const fresh = data.plans.some(
        (p) =>
          p.status === "confirmed" ||
          (p.status === "draft" && p.baseRevision === data.revision),
      );
      return [
        {
          title: "Capture the food and the need",
          detail:
            "Start with a donor message. Confirm the location, quantities, deadlines, handling, and declared allergens.",
          label: "Add a food offer",
          action: "new-offer",
          done: data.offers.length > 0 && data.requests.length > 0,
        },
        {
          title: "Review donor and recipient declarations",
          detail: pending
            ? `${pending} submissions need a human review before they can enter a plan.`
            : "No submissions are waiting for review. Check participant details before approving new records.",
          label: "Open review queue",
          action: "approvals",
          done:
            pending === 0 &&
            data.offers.some((o) => o.status === "approved") &&
            data.requests.some((r) => r.status === "approved"),
        },
        {
          title: "Compare, then build a feasible plan",
          detail:
            "Preview a volunteer disruption, inspect the reasons, then build a draft. A draft reserves nothing until confirmed.",
          label: "Open rescue planner",
          action: "plans",
          done: fresh,
        },
        {
          title: "Follow each handoff",
          detail:
            "The assigned volunteer accepts, collects, and records arrival. Follow the ordered delivery steps.",
          label: "Track deliveries",
          action: "deliveries",
          done: trips.some((t) =>
            ["picked_up", "awaiting_receipt", "delivered"].includes(t.status),
          ),
        },
        {
          title: "Count only confirmed receipts",
          detail: `${received} portions have a recorded recipient receipt. Assigned and reserved meals remain separate.`,
          label: "View received impact",
          action: "reports",
          done: received > 0,
        },
      ];
    }
    const kind =
      role === "donor"
        ? "offers"
        : role === "recipient"
          ? "requests"
          : "volunteers";
    const profile =
      role === "donor"
        ? "donors"
        : role === "recipient"
          ? "recipients"
          : "volunteers";
    return [
      {
        title: "Check your details",
        detail:
          "Keep your contact, location, and availability current. Your coordinator relies on these declarations.",
        label: "Review my profile",
        action: profile,
        done: false,
      },
      {
        title:
          role === "donor"
            ? "Offer surplus food"
            : role === "recipient"
              ? "Describe your community's needs"
              : "Check your assignments",
        detail:
          role === "volunteer"
            ? "Accept assigned trips, then follow collection and arrival in order. GPS sharing is optional."
            : "Submit complete details for coordinator review. Pending records are excluded from matching.",
        label:
          role === "donor"
            ? "Add food offer"
            : role === "recipient"
              ? "Add recipient need"
              : "View deliveries",
        action:
          role === "donor"
            ? "new-offer"
            : role === "recipient"
              ? "new-request"
              : "deliveries",
        done: role === "volunteer" ? trips.length > 0 : data[kind].length > 0,
      },
      {
        title: "Complete the handoff",
        detail:
          role === "recipient"
            ? "Confirm receipt only after the food arrives. This is the step that counts the portions as delivered."
            : "The receiving organisation or coordinator confirms receipt. Arrival alone does not count as delivery.",
        label: "Follow the handoff",
        action: "deliveries",
        done: received > 0,
      },
    ];
  }
  function markup(data) {
    const list = steps(data);
    return `<div class="guide-intro"><p>Follow the next decision from a surplus message to a recipient receipt. These indicators reflect records in this workspace; they do not certify food safety or real-world delivery.</p><p class="fine-print">Seeded fictional records may already satisfy some checks. Use each step to inspect the supporting records.</p></div><ol class="rescue-steps">${list.map((s, i) => `<li class="rescue-step"><span class="step-number" aria-hidden="true">${i + 1}</span><div><span class="step-status">${s.done ? "Evidence recorded" : "Next check"}</span><h2>${esc(s.title)}</h2><p>${esc(s.detail)}</p><button class="button secondary" data-action="${esc(s.action)}">${esc(s.label)}</button></div></li>`).join("")}</ol>`;
  }
  function comparison(data, currentRevision) {
    if (!data)
      return '<p class="fine-print">Choose an active volunteer to compare available supply before and after that change. No availability or reservations will be changed.</p>';
    const stale = data.revision !== currentRevision;
    return `<section class="comparison-result" aria-label="Volunteer disruption comparison"><h3>Without ${esc(data.volunteer.name)}</h3>${stale ? '<p class="notice warning-notice">The network changed after this comparison. Run it again before using these figures.</p>' : ""}<div class="comparison-table"><table><caption>Future unreserved work only</caption><thead><tr><th scope="col">Measure</th><th scope="col">Current network</th><th scope="col">Volunteer excluded</th></tr></thead><tbody><tr><th scope="row">Portions allocated</th><td>${data.baseline.metrics.allocated}</td><td>${data.alternative.metrics.allocated}</td></tr><tr><th scope="row">Trips proposed</th><td>${data.baseline.metrics.trips}</td><td>${data.alternative.metrics.trips}</td></tr></tbody></table></div><p class="comparison-delta"><strong>${data.difference < 0 ? `${Math.abs(data.difference)} fewer portions allocated` : data.difference > 0 ? `${data.difference} more portions allocated` : "Same number of portions allocated"}</strong></p>${data.alternative.unallocated.length ? `<ul>${data.alternative.unallocated.map((row) => `<li><strong>${esc(row.name)}: ${row.meals} portions remain.</strong> ${esc(row.reason)}</li>`).join("")}</ul>` : "<p>No supply remains unallocated in this preview.</p>"}<p class="fine-print">${esc(data.notice)}</p></section>`;
  }
  window.RescueGuide = { steps, markup, comparison };
})();
