/**
 * @fileoverview RescueRoute workspace shell, navigation, and page view renderers.
 * Exposes `window.createAppViews(deps)` for use by `public/app.js`.
 */
window.createAppViews = function createAppViews({
  $,
  esc,
  time,
  nice,
  date,
  status,
  empty,
  state,
  own,
  managed,
  find,
  onMountNetwork,
}) {
  const NAV = [
    ["guide", "Start a rescue", "?", "all"],
    ["network", "Live network", "◎", "all"],
    ["overview", "Overview", "▦", "all"],
    ["offers", "Food offers", "♧", "admin coordinator donor"],
    ["requests", "Recipient needs", "⌂", "admin coordinator recipient"],
    ["donors", "Donor network", "▱", "admin coordinator donor"],
    ["recipients", "Recipient network", "♧", "admin coordinator recipient"],
    ["volunteers", "Volunteers", "♙", "admin coordinator volunteer"],
    ["approvals", "Review queue", "✓", "admin coordinator"],
    ["plans", "Rescue planner", "⇄", "admin coordinator"],
    ["deliveries", "Deliveries", "↗", "all"],
    ["reports", "Impact & reports", "▥", "admin coordinator"],
    ["notifications", "Notifications", "◷", "all"],
    ["audit", "Activity log", "≡", "admin coordinator"],
    ["users", "User accounts", "♙", "admin"],
    ["settings", "Settings", "⚙", "admin"],
  ];

  const heading = (eyebrow, title, description, buttons = "") =>
    `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${buttons}</div></div>`;

  const button = (label, actionName, extra = "", secondary = false) =>
    `<button class="button ${secondary ? "secondary" : "dark"}" data-action="${actionName}" ${extra}>${label}</button>`;

  const metrics = (items) =>
    `<section class="metrics" aria-label="Workspace metrics">${items.map(([label, value, note, icon = "↗"]) => `<article class="metric"><div class="metric-top">${esc(label)}<span class="metric-icon" aria-hidden="true">${icon}</span></div><div class="metric-value">${esc(value)}</div><p class="metric-note">${esc(note)}</p></article>`).join("")}</section>`;

  const panel = (title, subtitle, content, extra = "") =>
    `<section class="panel"><div class="panel-heading"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${extra}</div>${content}</section>`;

  const allTrips = () =>
    state.data.plans
      .filter((p) => p.status === "confirmed")
      .flatMap((p) => p.assignments.map((t) => ({ ...t, planId: p.id })));

  function recentNotifications(limit = 5) {
    const items = state.data.notifications.slice(0, limit);
    return items.length
      ? items
          .map(
            (n) =>
              `<article class="notification-row"><span class="notification-dot" aria-hidden="true"></span><div><p>${esc(n.title)}</p><small>${esc(date(n.at))}</small></div></article>`,
          )
          .join("")
      : empty("Network updates will appear here as the team takes action.");
  }

  const map = (full = false) =>
    window.RescueMap?.markup(full) ||
    '<div class="empty-state">Loading the geographic map. Refresh if the map renderer is unavailable.</div>';

  const filters = () =>
    `<div class="table-toolbar"><label class="search-label" for="record-search"><span class="sr-only">Search records</span><input id="record-search" type="search" value="${esc(state.query)}" placeholder="Search names, food, or status…"></label><label for="record-filter" class="sr-only">Filter by status</label><select id="record-filter"><option value="">All statuses</option>${["pending", "approved", "rejected", "cancelled", "active", "inactive"].map((s) => `<option value="${s}" ${state.filter === s ? "selected" : ""}>${nice(s)}</option>`).join("")}</select></div>`;

  const table = (headers, rows) =>
    `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table><div class="empty-state" ${rows.length ? "hidden" : ""}>No records match this view. Create a record or adjust your filters.</div></div>`;

  /** Renders the authenticated workspace shell, sidebar navigation, and header. */
  function renderShell() {
    const d = state.data;
    const u = d.user;
    if (
      !NAV.some(
        (item) =>
          item[0] === state.view &&
          (item[3] === "all" || item[3].split(" ").includes(u.role)),
      )
    ) {
      state.view = "overview";
    }
    $("login-screen").hidden = true;
    const enteringWorkspace = $("workspace").hidden;
    $("workspace").hidden = false;
    if (enteringWorkspace) window.RescueMotion?.workspace();
    $("network-name").textContent = d.settings.networkName;
    $("role-caption").textContent = `${nice(u.role)} portal`;
    $("profile-name").textContent = u.name;
    if (state.session.deployment?.isolated) {
      $("deployment-badge").textContent = "Private cloud demo workspace";
    }
    $("profile-initials").textContent = u.name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0])
      .join("");
    $("session-footer").textContent =
      `Simulation: ${d.settings.serviceDate} · ${time(d.settings.now)} · No real dispatch`;
    $("navigation").innerHTML = NAV.filter(
      (n) => n[3] === "all" || n[3].split(" ").includes(u.role),
    )
      .map(
        ([id, label, icon]) =>
          `<button class="nav-item ${state.view === id ? "active" : ""}" data-nav="${id}" ${state.view === id ? 'aria-current="page"' : ""}><span aria-hidden="true">${icon}</span>${label}${id === "approvals" && d.totals?.pending ? `<span class="nav-count">${d.totals.pending}</span>` : ""}</button>`,
      )
      .join("");
    $("breadcrumb").textContent =
      NAV.find((n) => n[0] === state.view)?.[1] || "Overview";
  }

  function network() {
    return (
      heading(
        "LIVE NETWORK",
        "A real map. A shared picture.",
        "Explore donors, recipients, and volunteer positions. Demo placements, shared GPS fixes, and stale updates are labelled separately.",
      ) +
      panel(
        "The rescue network",
        "Click a marker or select an entity to inspect its details.",
        map(true),
      ) +
      `<div class="network-live-activity">${panel("Live activity", "Relevant network changes appear automatically while connected.", recentNotifications(8))}</div>`
    );
  }

  function tripCard(t) {
    const d = state.data;
    const u = d.user;
    const o = find("offers", t.offerId);
    const r = find("requests", t.requestId);
    const v = find("volunteers", t.volunteerId);
    const next = {
      assigned: ["accepted", "Accept assignment"],
      accepted: ["picked_up", "Confirm pickup"],
      picked_up: ["awaiting_receipt", "Arrived · request receipt"],
      awaiting_receipt: ["delivered", "Confirm food received"],
    }[t.status];
    const canAct =
      next &&
      (managed() ||
        (next[0] === "delivered"
          ? u.role === "recipient" && r.recipientId === u.entityId
          : u.role === "volunteer" && t.volunteerId === u.entityId));
    const record = t.events || [];
    return `<article class="delivery-card"><div class="delivery-card-head"><span class="meal-bubble">${t.meals}<small>meals</small></span><div><h3>${esc(t.donorName || o?.name || "Donor")} <span>→</span> ${esc(t.recipientName || r?.name || "Recipient")}</h3><p>${esc(t.food || o?.food || "")} · ${esc(t.volunteerName || v?.name || "Volunteer")}</p></div>${status(t.status || "draft")}</div><div class="delivery-facts"><span><strong>Collection</strong>${time(t.pickup)}</span><span><strong>Delivery</strong>${time(t.delivery)}</span><span><strong>Distance</strong>${t.km.toFixed(1)} km</span><span><strong>Handling</strong>${esc(t.handling || o?.handling || "Declared")}</span></div><p class="trip-reason">${esc(t.reason)}</p>${t.donorContact ? `<p class="trip-contact">Pickup contact: ${esc(t.donorContact)}<br>Delivery contact: ${esc(t.recipientContact)}</p>` : ""}${record.length ? `<ol class="delivery-timeline">${record.map((e) => `<li><strong>${esc(nice(e.status))}</strong><span>${esc(e.by)} · ${esc(date(e.at))}</span></li>`).join("")}</ol>` : ""}${canAct ? `<div class="delivery-action">${button(next[1], "transition", `data-plan="${t.planId}" data-id="${t.id}" data-status="${next[0]}"`)}<small>Simulated handoff · recorded in the activity log</small></div>` : ""}</article>`;
  }

  function overview() {
    const d = state.data;
    const u = d.user;
    const trips = allTrips();
    const t = d.totals;
    const ownOffers = d.offers.filter((o) => own("offers", o));
    const ownRequests = d.requests.filter((r) => own("requests", r));
    const roleItems =
      u.role === "donor"
        ? [
            ["My food offers", ownOffers.length, "Across all review statuses"],
            [
              "Meal portions offered",
              ownOffers.reduce((n, o) => n + o.meals, 0),
              "Declared quantities",
            ],
            [
              "Meals delivered",
              ownOffers.reduce((n, o) => n + o.delivered, 0),
              "Recipient-confirmed receipts",
            ],
            [
              "Meals reserved",
              ownOffers.reduce((n, o) => n + o.reserved, 0),
              "Committed to active trips",
            ],
          ]
        : u.role === "recipient"
          ? [
              ["My requests", ownRequests.length, "Across all review statuses"],
              [
                "Portions requested",
                ownRequests.reduce((n, r) => n + r.meals, 0),
                "Declared recipient needs",
              ],
              [
                "Meals received",
                ownRequests.reduce((n, r) => n + r.delivered, 0),
                "Receipt-confirmed",
              ],
              [
                "Meals on the way",
                ownRequests.reduce((n, r) => n + r.reserved, 0),
                "Reserved delivery portions",
              ],
            ]
          : [
              [
                "Assigned trips",
                trips.filter((trip) => trip.status !== "cancelled").length,
                "Confirmed plan assignments",
              ],
              [
                "Ready for pickup",
                trips.filter((trip) =>
                  ["assigned", "accepted"].includes(trip.status),
                ).length,
                "Uncollected assignments",
              ],
              [
                "In transit",
                trips.filter((trip) =>
                  ["picked_up", "awaiting_receipt"].includes(trip.status),
                ).length,
                "Awaiting completed handoff",
              ],
              [
                "Trips completed",
                trips.filter((trip) => trip.status === "delivered").length,
                "Recipient-confirmed",
              ],
            ];
    const heroAction = managed()
      ? button("Build rescue draft ↗", "build")
      : button(
          u.role === "donor"
            ? "Offer surplus food ＋"
            : u.role === "recipient"
              ? "Create a food request ＋"
              : "View my deliveries ↗",
          u.role === "donor"
            ? "new-offer"
            : u.role === "recipient"
              ? "new-request"
              : "deliveries",
        );
    const atRisk = d.offers.filter(
      (o) =>
        o.status === "approved" &&
        o.meals - o.reserved - o.delivered > 0 &&
        o.deadline - d.settings.now <= 45,
    );
    return (
      heading(
        `${d.settings.city} · ${nice(u.role)} portal`,
        `Good to have you here, ${u.name.split(" ")[0]}.`,
        "A little coordination. A lot less food going to waste.",
        managed() ? button("＋ Add food offer", "new-offer") : "",
      ) +
      `<section class="hero platform-hero"><div class="hero-copy"><span class="hero-label"><span></span> EVERY MEAL HAS SOMEWHERE TO GO</span><h2>Good food.<br>A better destination.</h2><p>${managed() ? "Bring food, people, and possibilities together.<br>Build a delivery plan your network can actually fulfil." : "Your contribution is part of something bigger.<br>Keep your details current and follow each handoff."}</p>${heroAction}<span class="hero-footnote">Donor confirmed · Constraint checked · Human approved</span></div><div class="hero-summary" aria-hidden="true"><div class="hero-orbit">♧</div><span>Small routes.<br>Meaningful change.</span></div></section>` +
      `<div class="guide-callout"><div><strong>A clear path from offer to receipt.</strong><p>New here? Follow the guided rescue checklist for your role.</p></div>${button("Start a rescue ?", "guide", "", true)}</div>` +
      metrics(
        managed()
          ? [
              ["Approved supply", t.offered, "Meal portions submitted", "♧"],
              ["Reserved meals", t.reserved, "Confirmed, not yet received", "⇄"],
              ["Meals delivered", t.delivered, "Recipient-confirmed only", "✓"],
              [
                "Available volunteers",
                t.volunteers,
                `${t.pending} records awaiting review`,
                "♙",
              ],
            ]
          : roleItems,
      ) +
      `<div class="dashboard-grid"><div class="stack">${managed() ? panel("The rescue network", "A shared picture of supply, demand, and people.", map()) : panel("Your next handoffs", "Every update is recorded in the delivery timeline.", trips.slice(0, 3).map(tripCard).join("") || empty("No deliveries assigned yet. Your coordinator will confirm a plan."))}${panel("Latest network updates", "Persisted notifications relevant to your role.", recentNotifications())}</div><div class="stack">${panel("Your coordination copilot", state.session.intake === "live" ? "Gemini configured - fallback ready" : "Local contextual rules - no key", `<div class="copilot-copy"><span class="assistant-symbol" aria-hidden="true">✳</span><p>${managed() ? `<strong>${atRisk.length} approved offers</strong> have remaining food and close within 45 simulation minutes.` : "Your workspace shows only records you own or need for an assigned delivery."}</p><p>Plans respect declared allergens, transport capability, quantities, pickup windows, and donor transit limits.</p>${button("Understand the decisions ↗", "explain", "", true)}</div>`)}${panel("A clear next step", "Useful actions for this session.", `<div class="quick-actions">${managed() ? `${button(`Review ${t.pending} pending records`, "approvals", "", true)}${button("Open rescue planner", "plans", "", true)}${button("Track delivery progress", "deliveries", "", true)}` : `${button("View delivery assignments", "deliveries", "", true)}${button("Read notifications", "notifications", "", true)}`}</div>`)}<div class="impact-note"><span>↗</span><p><strong>Evidence over estimates.</strong><br>Delivered meals are counted only after recipient confirmation. Scheduled meals stay separate.</p></div></div></div>`
    );
  }

  /** Renders filtered table rows for an entity collection. */
  function entityRows(kind) {
    return state.data[kind]
      .filter((r) => own(kind, r))
      .filter(
        (r) =>
          !state.query ||
          JSON.stringify([r.name, r.food, r.contact, r.status, r.vehicle])
            .toLowerCase()
            .includes(state.query.toLowerCase()),
      )
      .filter(
        (r) =>
          !state.filter ||
          (r.status || (r.active ? "active" : "inactive")) === state.filter,
      )
      .map((r) => {
        const meta =
          kind === "offers"
            ? `<strong>${esc(r.name)}</strong><small>${esc(r.food)}</small>`
            : `<strong>${esc(r.name)}</strong><small>${esc(r.contact || "")}</small>`;
        const actions = `<div class="row-actions">${button("Edit", "edit", `data-kind="${kind}" data-id="${esc(r.id)}"`, true)}${kind === "volunteers" ? button(r.active ? "Unavailable" : "Available", "availability", `data-id="${esc(r.id)}" data-active="${!r.active}"`, true) : ""}${["offers", "requests"].includes(kind) && r.status !== "cancelled" ? button("Withdraw", "withdraw", `data-kind="${kind}" data-id="${esc(r.id)}"`, true) : ""}${managed() ? `<button class="text-button danger-text" data-action="delete" data-kind="${kind}" data-id="${esc(r.id)}">Delete</button>` : ""}</div>`;
        if (kind === "offers" || kind === "requests") {
          return `<tr><td>${meta}${r.reviewNote ? `<small>Review: ${esc(r.reviewNote)}</small>` : ""}</td><td><strong>${r.meals}</strong><small>${r.delivered} delivered · ${r.reserved} reserved</small></td><td>${time(r.deadline)}<small>${kind === "offers" ? `${esc(r.handling)} · ${r.allergens.length ? esc(r.allergens.join(", ")) : "No allergens declared"}` : `Priority ${r.priority} · ${r.excludes.length ? `excludes ${esc(r.excludes.join(", "))}` : "no exclusions"}`}</small></td><td>${status(r.status)}</td><td>${actions}</td></tr>`;
        }
        if (kind === "volunteers") {
          return `<tr><td>${meta}<small>${esc(r.vehicle)}</small></td><td>${r.capacity} meals / trip<small>${r.chilled ? "Chilled capable" : "Ambient only"}</small></td><td>${time(r.available)}–${time(r.until)}</td><td>${status(r.active ? "active" : "inactive")}</td><td>${actions}</td></tr>`;
        }
        return `<tr><td>${meta}</td><td>${r.geo ? `${r.geo[0].toFixed(5)}, ${r.geo[1].toFixed(5)}` : "Illustrative placement"}<small>${esc(r.locationLabel || (r.geo ? "Entered coordinates" : "Demo location on a real map"))}</small></td><td>${status(r.active ? "active" : "inactive")}</td><td>${actions}</td></tr>`;
      });
  }

  function entities(kind) {
    const titles = {
      offers: [
        "Food offers",
        "Good food. Ready for a second chance.",
        "Quantity, collection windows, and donor-declared handling.",
      ],
      requests: [
        "Recipient needs",
        "Start with what people need.",
        "Approved needs become eligible for the next rescue draft.",
      ],
      donors: [
        "Donor network",
        "Where every rescue begins.",
        "Manage donor profiles and collection locations.",
      ],
      recipients: [
        "Recipient network",
        "Connected by a shared purpose.",
        "Manage community organisations and delivery locations.",
      ],
      volunteers: [
        "Volunteer network",
        "The people behind every rescue.",
        "Availability, vehicle capacity, and chilled transport capability.",
      ],
    };
    const [label, title, description] = titles[kind];
    const canCreate =
      managed() ||
      (kind === "offers" && state.data.user.role === "donor") ||
      (kind === "requests" && state.data.user.role === "recipient");
    const headers = ["offers", "requests"].includes(kind)
      ? [
          kind === "offers" ? "Donor & food" : "Recipient",
          "Portions",
          "Window & requirements",
          "Review status",
          "Actions",
        ]
      : kind === "volunteers"
        ? ["Volunteer", "Transport", "Shift", "Availability", "Actions"]
        : ["Organisation", "Location", "Status", "Actions"];
    return (
      heading(
        label.toUpperCase(),
        title,
        description,
        canCreate
          ? button(
              `＋ Add ${kind === "offers" ? "food offer" : kind === "requests" ? "request" : kind.slice(0, -1)}`,
              "new",
              `data-kind="${kind}"`,
            )
          : "",
      ) +
      `<div class="notice">${["offers", "requests"].includes(kind) ? "Changes require review. Confirmed reservations lock their source records until the trips are completed or released." : "Linked records retain their history. Deactivate a profile instead of deleting one that has linked accounts or deliveries."}</div>` +
      panel(
        label,
        `${state.data[kind].filter((r) => own(kind, r)).length} records in your workspace`,
        filters() + table(headers, entityRows(kind)),
      )
    );
  }

  function approvals() {
    const rows = ["offers", "requests"].flatMap((kind) =>
      state.data[kind]
        .filter((r) => r.status === "pending")
        .map(
          (r) =>
            `<article class="review-card"><div><div class="eyebrow">${kind === "offers" ? "FOOD OFFER" : "RECIPIENT REQUEST"}</div><h3>${esc(r.name)}</h3><p>${kind === "offers" ? esc(r.food) : `Priority ${r.priority}`} · ${r.meals} portions · deadline ${time(r.deadline)}</p><p>${kind === "offers" ? `${esc(r.handling)} · ${r.allergens.length ? esc(r.allergens.join(", ")) : "No allergens declared"} · donor ${r.donorConfirmed ? "confirmed details" : "confirmation missing"}` : `Excluded allergens: ${esc(r.excludes.join(", ") || "none")}`}</p>${r.notes ? `<p>${esc(r.notes)}</p>` : ""}</div><div class="row-actions">${button("Review & edit", "edit", `data-kind="${kind}" data-id="${r.id}"`, true)}${button("Approve", "review", `data-kind="${kind}" data-id="${r.id}" data-status="approved"`)}${button("Reject", "review", `data-kind="${kind}" data-id="${r.id}" data-status="rejected"`, true)}</div></article>`,
        ),
    );
    return (
      heading(
        "COORDINATOR REVIEW",
        "Trust starts with the details.",
        "Review donor declarations and recipient needs before they enter a plan.",
      ) +
      panel(
        "Pending submissions",
        `${rows.length} records awaiting a decision`,
        rows.join("") ||
          empty("The review queue is clear. New submissions will appear here."),
      )
    );
  }

  function plans() {
    const d = state.data;
    const selected =
      d.plans.find((p) => p.id === state.selectedPlan) || d.plans[0];
    const controls =
      button("✳ Build new draft", "build") +
      button("Release uncollected trips", "release", "", true);
    let content = empty(
      "Build your first rescue draft. Only approved, unreserved meals and available volunteers will be considered.",
    );
    if (selected) {
      const stale =
        selected.status === "draft" && selected.baseRevision !== d.revision;
      content = `<div class="plan-overview"><div>${status(selected.status)}<span>${esc(date(selected.createdAt))} · ${esc(selected.createdBy)}</span></div><h3>${selected.metrics.allocated} meals · ${selected.metrics.trips} trips · ${selected.metrics.km} km</h3><p>${selected.status === "draft" ? "Proposed allocations reserve nothing until you confirm." : "Confirmed trip quantities stay reserved until receipt or cancellation."}</p>${stale ? '<div class="notice warning-notice">This draft is stale because the network changed. Build a new draft before confirming.</div>' : ""}${selected.status === "draft" ? `<button class="button dark" data-action="confirm" data-id="${selected.id}" ${stale || !selected.assignments.length ? "disabled data-locked" : ""}>Confirm & reserve meals</button>` : ""}</div>${selected.assignments.map((t) => tripCard({ ...t, planId: selected.id })).join("")}${selected.unallocated.map((x) => `<div class="unallocated"><strong>${x.meals} meals unallocated · ${esc(selected.snapshot.offers.find((o) => o.id === x.offerId)?.name)}</strong><br>${esc(x.reason)}</div>`).join("")}${selected.unmet.length ? `<div class="fine-print"><strong>Unmatched needs at draft time:</strong> ${selected.unmet.map((x) => `${esc(selected.snapshot.requests.find((r) => r.id === x.requestId)?.name)}: ${x.meals} portions`).join(" · ")}</div>` : ""}`;
    }
    return (
      heading(
        "RESCUE OPERATIONS",
        "A route from surplus to purpose.",
        "Build, inspect, and confirm a plan against the current network.",
        controls,
      ) +
      panel(
        "What if a volunteer becomes unavailable?",
        "Compare the impact before changing the network. This preview never cancels committed trips.",
        `<form id="preview-form" class="preview-controls"><div><label for="preview-volunteer">Volunteer to exclude from future matching</label><select id="preview-volunteer" name="volunteerId" required><option value="">Choose an active volunteer</option>${d.volunteers
          .filter((v) => v.active)
          .map(
            (v) =>
              `<option value="${esc(v.id)}" ${state.comparison?.volunteer.id === v.id ? "selected" : ""}>${esc(v.name)}${v.chilled ? " ? chilled capable" : ""}</option>`,
          )
          .join(
            "",
          )}</select></div><button class="button secondary" type="submit" ${state.comparing ? "disabled" : ""}>${state.comparing ? "Comparing?" : "Compare plans"}</button></form><p id="preview-error" role="alert"></p><div id="preview-result" role="status">${window.RescueGuide.comparison(state.comparison, d.revision)}</div>`,
      ) +
      `<div class="notice">One load per trip. Sequential driver schedules. Chilled transport, declared allergens, donor use-by times, and recipient deadlines are checked. The heuristic does not guarantee a globally optimal plan.</div><div class="planner-grid">${panel("Current plan", "Schedule times use the explicit simulation clock.", content)}${panel("Plan history", `${d.plans.length} persisted versions`, `<div class="plan-history">${d.plans.map((p) => `<button class="history-item ${p.id === selected?.id ? "selected" : ""}" data-action="select-plan" data-id="${p.id}"><strong>${p.metrics.allocated} meals · ${p.metrics.trips} trips</strong><span>${esc(date(p.createdAt))}</span>${status(p.status)}</button>`).join("") || empty("No plans yet.")}</div>`)}</div>`
    );
  }

  function deliveries() {
    const trips = allTrips().filter(
      (t) => !state.filter || t.status === state.filter,
    );
    return (
      heading(
        "COLLECTION TO CONFIRMATION",
        "Every handoff, accounted for.",
        "Accept → collect → arrive → recipient receipt. Delivered totals require the final receipt.",
      ) +
      `<div class="table-toolbar"><label for="trip-filter">Delivery status</label><select id="trip-filter"><option value="">All deliveries</option>${["assigned", "accepted", "picked_up", "awaiting_receipt", "delivered", "cancelled"].map((s) => `<option value="${s}" ${s === state.filter ? "selected" : ""}>${nice(s)}</option>`).join("")}</select></div>` +
      panel(
        "Delivery workspace",
        `${trips.length} matching trips · all times are simulated`,
        trips.map(tripCard).join("") ||
          empty(
            "No confirmed trips match this view. A coordinator must first confirm a rescue plan.",
          ),
      )
    );
  }

  function reports() {
    const d = state.data;
    const t = d.totals;
    const rows = d.donors.map((donor) => {
      const offers = d.offers.filter((o) => o.donorId === donor.id);
      return `<tr><td><strong>${esc(donor.name)}</strong></td><td>${offers.reduce((n, o) => n + o.meals, 0)}</td><td>${offers.reduce((n, o) => n + o.reserved, 0)}</td><td>${offers.reduce((n, o) => n + o.delivered, 0)}</td></tr>`;
    });
    return (
      heading(
        "MEASURE WHAT ACTUALLY HAPPENED",
        "Impact with a clear paper trail.",
        "Simulated receipts are kept separate from offers and reservations.",
        button("Export full report ↓", "export") +
          button("Download donor CSV ↓", "csv", "", true),
      ) +
      metrics([
        ["Meals received", t.delivered, "Recipient-confirmed only"],
        ["Meals reserved", t.reserved, "Not yet counted as delivered"],
        ["Completed trips", t.tripsDelivered, "Receipt-confirmed handoffs"],
        ["Approved recipient demand", t.requested, "Declared meal portions"],
      ]) +
      panel(
        "Donor contribution",
        "Historical totals across all review statuses; delivered and reserved are backed by confirmed trips.",
        table(
          [
            "Donor",
            "Offered portions",
            "Reserved portions",
            "Delivered portions",
          ],
          rows,
        ),
      ) +
      `<div class="notice">These are local demonstration records. No monetary savings, carbon reductions, or real-world meal deliveries are inferred.</div>`
    );
  }

  function users() {
    return (
      heading(
        "ADMINISTRATION",
        "The right access for every person.",
        "Permissions are enforced by the server, including ownership checks.",
        button("＋ Create account", "new-user"),
      ) +
      panel(
        "User accounts",
        "Roles and account links are fixed after creation. Edit a name, email, active status, or password.",
        table(
          ["Person", "Role", "Profile link", "Access", "Actions"],
          state.data.users.map(
            (u) =>
              `<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.email)}</small></td><td>${status(u.role)}</td><td>${esc(find(u.role === "donor" ? "donors" : u.role === "recipient" ? "recipients" : "volunteers", u.entityId)?.name || "Network-wide")}</td><td>${status(u.active ? "active" : "inactive")}</td><td>${button("Manage", "edit-user", `data-id="${u.id}"`, true)}</td></tr>`,
          ),
        ),
      )
    );
  }

  function settings() {
    const s = state.data.settings;
    return (
      heading(
        "NETWORK SETTINGS",
        "A workspace with clear boundaries.",
        "Local persistence, simulation controls, and provider status.",
      ) +
      `<div class="settings-grid">${panel("Network & simulation", "The clock can move forward only when no deliveries are active.", `<form id="settings-form" class="settings-form"><label for="setting-network">Network name</label><input id="setting-network" name="networkName" required maxlength="120" value="${esc(s.networkName)}"><label for="setting-city">City name</label><input id="setting-city" name="city" required maxlength="120" value="${esc(s.city)}"><label for="setting-now">Simulation clock (${s.serviceDate})</label><input id="setting-now" name="now" type="time" required min="${time(s.now)}" value="${time(s.now)}"><p class="fine-print">Planning assumptions: geographic straight-line distance at 24 km/h, with 4 minutes each for pickup and handover.</p><button class="button dark" type="submit">Save settings</button><p id="settings-error" class="form-error" role="alert"></p></form>`)}<div class="stack">${panel("AI connection", state.session.intake === "live" ? "Gemini configured" : "Local contextual engine", `<div class="settings-copy"><p>${state.session.intake === "live" ? "Submitted donor messages are sent to Google Gemini for JSON extraction. Provider failures fall back to clearly labelled local rules. Every draft still requires human review." : "Local contextual rules extract supported facts, detect conflicts, and ask for missing details without an API key."}</p><p>Configure GEMINI_API_KEY and GEMINI_MODEL in the server environment and restart. Public demos also require PUBLIC_AI_ENABLED=true. Keys are never accepted or displayed in the browser.</p></div>`)}${panel("Demo data controls", "This affects all accounts and all local operational records.", `<div class="settings-copy"><p>Records persist in the local data file across browser refreshes and server restarts. Export a report before resetting anything you want to keep.</p>${button("Export current report", "export", "", true)}${button("Reset the demo network", "reset", "", true)}</div>`)}</div></div>`
    );
  }

  /** Renders the active view into `#page-content` and mounts the map. */
  function render() {
    if (!state.data) return;
    const pages = {
      overview,
      guide: () =>
        heading(
          "FROM MESSAGE TO RECEIPT",
          "Your next rescue, step by step.",
          "A practical checklist for your role in this network.",
        ) + window.RescueGuide.markup(state.data),
      network,
      approvals,
      plans,
      deliveries,
      reports,
      users,
      settings,
      notifications: () =>
        heading(
          "YOUR NETWORK UPDATES",
          "Stay connected to the next step.",
          "Recent persisted updates for your role and linked profile.",
        ) +
        panel("Notifications", "Most recent first", recentNotifications(50)),
      audit: () =>
        heading(
          "ACCOUNTABILITY",
          "A history of decisions.",
          "The latest 200 server-recorded network actions.",
        ) +
        panel(
          "Activity log",
          "Every successful operational mutation has an actor and timestamp.",
          table(
            ["Time", "Actor", "Action", "Detail"],
            state.data.audit.map(
              (a) =>
                `<tr><td>${esc(date(a.at))}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`,
            ),
          ),
        ),
    };
    window.RescueMap?.destroy();
    $("page-content").innerHTML = pages[state.view]
      ? pages[state.view]()
      : entities(state.view);
    onMountNetwork();
    if (state.motionView !== state.view) {
      window.RescueMotion?.page($("page-content"));
      state.motionView = state.view;
    }
  }

  /** Navigates to an allowed view, resets filters, and moves focus to `h1`. */
  function navigate(view) {
    if (
      !NAV.some(
        (n) =>
          n[0] === view &&
          (n[3] === "all" || n[3].split(" ").includes(state.data.user.role)),
      )
    ) {
      return;
    }
    state.view = view;
    state.query = "";
    state.filter = "";
    renderShell();
    render();
    const title = $("page-content").querySelector("h1");
    if (title) {
      title.tabIndex = -1;
      title.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  return { NAV, renderShell, render, navigate, entityRows };
};
