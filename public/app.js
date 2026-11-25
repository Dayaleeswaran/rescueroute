const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const time = (n) =>
  `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const minutes = (s) => {
  const [h, m] = String(s).split(":").map(Number);
  return h * 60 + m;
};
const nice = (s) =>
  String(s)
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
const date = (s) =>
  new Date(s).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
const status = (s) =>
  `<span class="status status-${esc(s)}">${esc(nice(s))}</span>`;
const empty = (text) =>
  `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">♧</span>${esc(text)}</div>`;
const state = {
  session: null,
  data: null,
  view: "overview",
  query: "",
  filter: "",
  selectedPlan: null,
  comparison: null,
  comparing: false,
  busy: false,
  motionView: null,
};
let toastTimer;
const managed = () => ["admin", "coordinator"].includes(state.data?.user.role);
const own = (kind, row) =>
  managed() ||
  (kind === "offers" && row.donorId === state.data.user.entityId) ||
  (kind === "requests" && row.recipientId === state.data.user.entityId) ||
  (["volunteers", "donors", "recipients"].includes(kind) &&
    row.id === state.data.user.entityId);
const find = (kind, id) => state.data[kind].find((x) => x.id === id);
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6500);
}
async function api(path, data, method = "POST") {
  const options =
    data === undefined
      ? {}
      : {
          method,
          headers: {
            "Content-Type": "application/json",
            ...(state.session ? { "X-CSRF-Token": state.session.csrf } : {}),
          },
          body: JSON.stringify(data),
        };
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/api/login") showLogin();
    const error = new Error(
      result.error || "The request failed. Please try again.",
    );
    error.status = response.status;
    throw error;
  }
  return result;
}
async function refresh() {
  const session = state.session;
  const next = await api("/api/state");
  if (session !== state.session) return;
  state.data = next;
  renderShell();
  render();
  startLive();
}
function showLogin() {
  stopLiveResources();
  window.RescueMap?.reset();
  state.session = null;
  state.data = null;
  state.comparison = null;
  state.comparing = false;
  $("workspace").hidden = true;
  $("login-screen").hidden = false;
  state.motionView = null;
  window.RescueMotion?.login();
}
async function action(
  path,
  data = {},
  message = "Saved.",
  { close = false, method = "POST" } = {},
) {
  if (state.busy) return false;
  state.busy = true;
  document
    .querySelectorAll('button[data-action], #editor button[type="submit"]')
    .forEach((b) => (b.disabled = true));
  try {
    const result = await api(
      path,
      { revision: state.data.revision, ...data },
      method,
    );
    if (path === "/api/plans/build") state.selectedPlan = result.result;
    await refresh();
    if (close) $("editor").close();
    toast(message);
    return true;
  } catch (error) {
    if (error.status === 401) $("editor").close();
    if (error.status === 409) await refresh().catch(() => {});
    if ($("editor").open) {
      const el = $("form-error");
      if (el) el.textContent = error.message;
      else toast(error.message);
    } else toast(error.message);
    return false;
  } finally {
    state.busy = false;
    document
      .querySelectorAll('button[data-action], #editor button[type="submit"]')
      .forEach((b) => {
        if (!b.hasAttribute("data-locked")) b.disabled = false;
      });
  }
}

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
function renderShell() {
  const d = state.data,
    u = d.user;
  if (
    !NAV.some(
      (item) =>
        item[0] === state.view &&
        (item[3] === "all" || item[3].split(" ").includes(u.role)),
    )
  )
    state.view = "overview";
  $("login-screen").hidden = true;
  const enteringWorkspace = $("workspace").hidden;
  $("workspace").hidden = false;
  if (enteringWorkspace) window.RescueMotion?.workspace();
  $("network-name").textContent = d.settings.networkName;
  $("role-caption").textContent = `${nice(u.role)} portal`;
  $("profile-name").textContent = u.name;
  if (state.session.deployment?.isolated)
    $("deployment-badge").textContent = "Private cloud demo workspace";
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
function heading(eyebrow, title, description, buttons = "") {
  return `<div class="page-heading"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p>${esc(description)}</p></div><div class="heading-actions">${buttons}</div></div>`;
}
const button = (label, actionName, extra = "", secondary = false) =>
  `<button class="button ${secondary ? "secondary" : "dark"}" data-action="${actionName}" ${extra}>${label}</button>`;
function metrics(items) {
  return `<section class="metrics" aria-label="Workspace metrics">${items.map(([label, value, note, icon = "↗"]) => `<article class="metric"><div class="metric-top">${esc(label)}<span class="metric-icon" aria-hidden="true">${icon}</span></div><div class="metric-value">${esc(value)}</div><p class="metric-note">${esc(note)}</p></article>`).join("")}</section>`;
}
function panel(title, subtitle, content, extra = "") {
  return `<section class="panel"><div class="panel-heading"><div><h2>${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div>${extra}</div>${content}</section>`;
}
function allTrips() {
  return state.data.plans
    .filter((p) => p.status === "confirmed")
    .flatMap((p) => p.assignments.map((t) => ({ ...t, planId: p.id })));
}
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
function map(full = false) {
  return (
    window.RescueMap?.markup(full) ||
    '<div class="empty-state">Loading the geographic map. Refresh if the map renderer is unavailable.</div>'
  );
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

function overview() {
  const d = state.data,
    u = d.user,
    trips = allTrips(),
    t = d.totals;
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
              trips.filter((t) => t.status !== "cancelled").length,
              "Confirmed plan assignments",
            ],
            [
              "Ready for pickup",
              trips.filter((t) => ["assigned", "accepted"].includes(t.status))
                .length,
              "Uncollected assignments",
            ],
            [
              "In transit",
              trips.filter((t) =>
                ["picked_up", "awaiting_receipt"].includes(t.status),
              ).length,
              "Awaiting completed handoff",
            ],
            [
              "Trips completed",
              trips.filter((t) => t.status === "delivered").length,
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
function filters() {
  return `<div class="table-toolbar"><label class="search-label" for="record-search"><span class="sr-only">Search records</span><input id="record-search" type="search" value="${esc(state.query)}" placeholder="Search names, food, or status…"></label><label for="record-filter" class="sr-only">Filter by status</label><select id="record-filter"><option value="">All statuses</option>${["pending", "approved", "rejected", "cancelled", "active", "inactive"].map((s) => `<option value="${s}" ${state.filter === s ? "selected" : ""}>${nice(s)}</option>`).join("")}</select></div>`;
}
function table(headers, rows) {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table><div class="empty-state" ${rows.length ? "hidden" : ""}>No records match this view. Create a record or adjust your filters.</div></div>`;
}
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
      if (kind === "offers" || kind === "requests")
        return `<tr><td>${meta}${r.reviewNote ? `<small>Review: ${esc(r.reviewNote)}</small>` : ""}</td><td><strong>${r.meals}</strong><small>${r.delivered} delivered · ${r.reserved} reserved</small></td><td>${time(r.deadline)}<small>${kind === "offers" ? `${esc(r.handling)} · ${r.allergens.length ? esc(r.allergens.join(", ")) : "No allergens declared"}` : `Priority ${r.priority} · ${r.excludes.length ? `excludes ${esc(r.excludes.join(", "))}` : "no exclusions"}`}</small></td><td>${status(r.status)}</td><td>${actions}</td></tr>`;
      if (kind === "volunteers")
        return `<tr><td>${meta}<small>${esc(r.vehicle)}</small></td><td>${r.capacity} meals / trip<small>${r.chilled ? "Chilled capable" : "Ambient only"}</small></td><td>${time(r.available)}–${time(r.until)}</td><td>${status(r.active ? "active" : "inactive")}</td><td>${actions}</td></tr>`;
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
function tripCard(t) {
  const d = state.data,
    u = d.user,
    o = find("offers", t.offerId),
    r = find("requests", t.requestId),
    v = find("volunteers", t.volunteerId);
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
  const d = state.data,
    t = d.totals;
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
      ) + panel("Notifications", "Most recent first", recentNotifications(50)),
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
  mountNetwork();
  if (state.motionView !== state.view) {
    window.RescueMotion?.page($("page-content"));
    state.motionView = state.view;
  }
}
function navigate(view) {
  if (
    !NAV.some(
      (n) =>
        n[0] === view &&
        (n[3] === "all" || n[3].split(" ").includes(state.data.user.role)),
    )
  )
    return;
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

function field(name, label, value = "", type = "text", extra = "") {
  return `<div><label for="field-${name}">${label}</label><input id="field-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
}
function select(name, label, value, options, extra = "") {
  return `<div><label for="field-${name}">${label}</label><select id="field-${name}" name="${name}" ${extra}>${options.map(([v, text]) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(text)}</option>`).join("")}</select></div>`;
}
function checkbox(name, label, checked = false) {
  return `<label class="checkbox-label"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}><span>${label}</span></label>`;
}
function openEditor(title, content) {
  $("editor-title").textContent = title;
  $("editor-content").innerHTML = content;
  $("editor").showModal();
}
function formEnd(label = "Save record") {
  return `<p id="form-error" class="form-error" role="alert"></p><button class="button dark full" type="submit">${label}</button></form>`;
}
function renderIntakeResult(result) {
  const local = result.mode !== "live";
  const source = local ? "Local contextual draft" : "Gemini JSON draft";
  const facts = Object.entries(result.evidence || {})
    .map(
      ([field, fact]) =>
        `<div><dt>${esc(nice(field))}</dt><dd>${esc(JSON.stringify(result.draft[field]))}<small>Source: ${esc(fact.text)}${fact.kind === "derived-from-clock" ? " (derived from the simulation clock)" : ""}</small></dd></div>`,
    )
    .join("");
  $("extract-result").innerHTML =
    `<div class="intake-review"><strong>${source}</strong><p>${esc(result.fallback?.message || `Requested model: ${result.configuredModel}. Reported model: ${result.actualModel || "not supplied by provider"}.`)}</p><p>${result.completeness.known} of ${result.completeness.total} fields supported. Human review is still required.</p>${result.warnings.length ? `<ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>` : ""}${result.questions.length ? `<ul>${result.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul>` : ""}<details><summary>View the source facts</summary><dl class="intake-evidence">${facts || "<p>No supported facts were found.</p>"}</dl></details><p>Confirm the organisation, location, use-by, and handling requirements before saving.</p></div>`;
}
function editEntity(kind, id, draft = {}) {
  const old = id && find(kind, id);
  const r = old || draft;
  const openedRevision = state.data.revision;
  let fields;
  if (["donors", "recipients", "volunteers"].includes(kind)) {
    const placement = r.geo ||
      state.data.mapData?.entities.find((e) => e.id === r.id)?.coordinates || [
        6.917, 79.877,
      ];
    fields =
      field("name", "Name", r.name, "text", 'required maxlength="120"') +
      field(
        "contact",
        "Contact email or phone",
        r.contact,
        "text",
        'required maxlength="120"',
      ) +
      select(
        "locationMode",
        "Map placement",
        r.geo ? "manual" : "demo",
        [
          ["demo", "Illustrative demo placement"],
          ["manual", "Use the coordinates below"],
        ],
        "required",
      ) +
      field(
        "locationLabel",
        "Address or location label (optional)",
        r.locationLabel || "",
        "text",
        'maxlength="180"',
      ) +
      field(
        "latitude",
        "Latitude",
        placement[0],
        "number",
        'required min="-85" max="85" step="any"',
      ) +
      field(
        "longitude",
        "Longitude",
        placement[1],
        "number",
        'required min="-180" max="180" step="any"',
      );
    if (kind === "volunteers")
      fields +=
        field(
          "vehicle",
          "Vehicle",
          r.vehicle || "Car",
          "text",
          'required maxlength="120"',
        ) +
        field(
          "capacity",
          "Meal capacity per trip",
          r.capacity || 30,
          "number",
          'required min="1" max="500" step="1"',
        ) +
        field(
          "available",
          "Available from",
          time(r.available ?? state.data.settings.now),
          "time",
          "required",
        ) +
        field("until", "Shift ends", time(r.until ?? 1080), "time", "required");
    fields =
      `<div class="form-grid">${fields}</div>` +
      (kind === "volunteers"
        ? checkbox(
            "chilled",
            "This vehicle can meet the donor’s declared chilled handling requirements.",
            r.chilled,
          )
        : "") +
      checkbox(
        "active",
        kind === "volunteers"
          ? "Available for new assignments"
          : "Organisation is active",
        r.active ?? true,
      );
  } else {
    const offer = kind === "offers";
    const parents = state.data[offer ? "donors" : "recipients"].filter(
      (x) => x.active || x.id === r[offer ? "donorId" : "recipientId"],
    );
    const parentId =
      r[offer ? "donorId" : "recipientId"] ||
      (managed() ? parents[0]?.id : state.data.user.entityId);
    const parent = select(
      offer ? "donorId" : "recipientId",
      offer ? "Donor organisation" : "Recipient organisation",
      parentId,
      parents.map((x) => [x.id, x.name]),
      `required ${old || !managed() ? "disabled" : ""}`,
    );
    fields =
      parent +
      (offer
        ? field(
            "food",
            "Food description",
            r.food,
            "text",
            'required maxlength="120"',
          )
        : "") +
      field(
        "meals",
        "Meal portions",
        r.meals,
        "number",
        'required min="1" max="1000" step="1"',
      ) +
      field(
        "deadline",
        offer ? "Collection complete by" : "Delivery complete by",
        typeof r.deadline === "string" ? r.deadline : time(r.deadline ?? 1050),
        "time",
        `required min="${time(state.data.settings.now)}"`,
      );
    if (offer)
      fields +=
        field(
          "ready",
          "Ready for collection",
          time(r.ready ?? state.data.settings.now),
          "time",
          "required",
        ) +
        field(
          "deliverBy",
          "Donor-declared delivery use-by",
          time(r.deliverBy ?? 1080),
          "time",
          "required",
        ) +
        field(
          "maxTransitMinutes",
          "Maximum transit + handover (minutes)",
          r.maxTransitMinutes ?? 60,
          "number",
          'required min="1" max="240" step="1"',
        ) +
        select(
          "handling",
          "Required transport",
          r.handling || "",
          [
            ["", "Confirm with donor"],
            ["ambient", "Ambient"],
            ["chilled", "Chilled"],
          ],
          "required",
        ) +
        field(
          "allergens",
          "Declared allergens (comma separated, or “none”)",
          Array.isArray(r.allergens) ? r.allergens.join(", ") || "none" : "",
          "text",
          'required maxlength="250"',
        );
    else
      fields +=
        field(
          "excludes",
          "Excluded allergens (comma separated, or “none”)",
          r.excludes?.join(", ") || "none",
          "text",
          'required maxlength="250"',
        ) +
        select(
          "priority",
          "Declared priority",
          String(r.priority || 2),
          [
            ["1", "1 · Standard"],
            ["2", "2 · Elevated"],
            ["3", "3 · Urgent"],
          ],
          "required",
        );
    fields =
      `<div class="form-grid">${fields}</div>` +
      `<label for="field-notes">Coordination notes</label><textarea id="field-notes" name="notes" maxlength="1000" rows="2">${esc(r.notes || "")}</textarea>` +
      (offer
        ? checkbox(
            "donorConfirmed",
            "The donor has confirmed quantities, ingredients and declared allergens, food suitability, location, use-by, and handling requirements.",
            r.donorConfirmed,
          )
        : "") +
      (managed()
        ? checkbox(
            "approve",
            "I reviewed these details. Approve this record for planning.",
            old?.status === "approved",
          )
        : '<p class="fine-print">Your submission will enter the coordinator review queue. Editing an approved record requires review again.</p>');
  }
  const intake =
    kind === "offers" && !old
      ? `<details class="intake-details"><summary>✳ Start from a donor message</summary><p>${state.session.intake === "live" ? "Gemini JSON extraction sends this message to Google. Local fallback is available if the request fails. Use fictional data." : "Local contextual mode. Explicit facts and the simulation clock support extraction; conflicting or missing facts require clarification."}</p><label for="intake-message">Donor message</label><textarea id="intake-message" maxlength="3000" rows="4"></textarea><div class="intake-tools"><button class="text-button" id="fill-sample" type="button">Use sample</button><button class="button secondary" type="button" id="extract-offer">Extract details</button></div><div id="extract-result" role="status"></div></details>`
      : "";
  openEditor(
    `${old ? "Edit" : "Add"} ${kind === "offers" ? "food offer" : kind === "requests" ? "recipient request" : kind.slice(0, -1)}`,
    intake +
      `<form id="record-form">${fields}${formEnd(["offers", "requests"].includes(kind) ? "Save reviewed details" : "Save profile")}`,
  );
  $("record-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const input = Object.fromEntries(f);
    input.revision = openedRevision;
    if (old) input.id = old.id;
    if (["donors", "recipients", "volunteers"].includes(kind)) {
      input.point = old?.point || [3, 3];
      input.geo =
        input.locationMode === "manual"
          ? [Number(input.latitude), Number(input.longitude)]
          : null;
      input.active = f.has("active");
    }
    if (kind === "volunteers") {
      input.capacity = Number(input.capacity);
      input.available = minutes(input.available);
      input.until = minutes(input.until);
      input.chilled = f.has("chilled");
    }
    if (kind === "offers" || kind === "requests") {
      input[kind === "offers" ? "donorId" : "recipientId"] =
        old?.[kind === "offers" ? "donorId" : "recipientId"] ||
        input[kind === "offers" ? "donorId" : "recipientId"] ||
        state.data.user.entityId;
      input.meals = Number(input.meals);
      input.deadline = minutes(input.deadline);
      input.approve = f.has("approve");
      const key = kind === "offers" ? "allergens" : "excludes";
      input[key] = /^none$/i.test(input[key].trim())
        ? []
        : input[key]
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
      if (kind === "offers") {
        input.ready = minutes(input.ready);
        input.deliverBy = minutes(input.deliverBy);
        input.maxTransitMinutes = Number(input.maxTransitMinutes);
        input.donorConfirmed = f.has("donorConfirmed");
      } else input.priority = Number(input.priority);
    }
    await action(
      `/api/entities/${kind}`,
      input,
      "Record saved. The planning state has been updated.",
      { close: true },
    );
  });
  if ($("fill-sample"))
    $("fill-sample").addEventListener(
      "click",
      () =>
        ($("intake-message").value =
          "Donor: The Green Table\nFood: Roasted vegetable meal boxes\nWe have 15 meals available. Collect by 17:30.\nHandling: ambient\nAllergens: none"),
    );
  if ($("extract-offer"))
    $("extract-offer").addEventListener("click", async () => {
      const b = $("extract-offer"),
        output = $("extract-result"),
        form = $("record-form");
      b.disabled = true;
      output.setAttribute("aria-busy", "true");
      output.innerHTML =
        '<div class="intake-processing"><progress aria-label="Extracting and checking donation facts"></progress><span>Extracting and validating supplied facts...</span></div>';
      try {
        const result = await api("/api/intake", {
          message: $("intake-message").value,
        });
        if (!b.isConnected || !$("editor").open) return;
        const confirmation = form?.querySelector('[name="donorConfirmed"]');
        if (confirmation) confirmation.checked = false;
        for (const [key, value] of Object.entries(result.draft)) {
          if (key === "name") continue;
          const el = $(`field-${key}`);
          if (el)
            el.value =
              value === null
                ? ""
                : Array.isArray(value)
                  ? value.join(", ") || "none"
                  : value;
        }
        renderIntakeResult(result);
      } catch (e) {
        if (b.isConnected) output.textContent = e.message;
      } finally {
        b.disabled = false;
        output.setAttribute("aria-busy", "false");
      }
    });
}
function editUser(id) {
  const u = id && find("users", id),
    openedRevision = state.data.revision;
  openEditor(
    u ? "Manage user account" : "Create user account",
    `<form id="user-form"><div class="form-grid">${field("name", "Display name", u?.name, "text", 'required maxlength="120"')}${field("email", "Email address", u?.email, "email", 'required maxlength="120"')}${select(
      "role",
      "Role (fixed after creation)",
      u?.role || "coordinator",
      ["admin", "coordinator", "donor", "recipient", "volunteer"].map((r) => [
        r,
        nice(r),
      ]),
      u ? "disabled" : "",
    )}${select("entityId", "Linked profile (for participant roles)", u?.entityId || "", [["", "Network-wide / choose role first"], ...["donors", "recipients", "volunteers"].flatMap((k) => state.data[k].map((x) => [x.id, `${k.slice(0, -1)} · ${x.name}`]))], u ? "disabled" : "")}</div>${field("password", u ? "New password (leave blank to keep existing)" : "Initial password", "", "password", `minlength="10" maxlength="128" autocomplete="new-password" ${u ? "" : "required"}`)}${checkbox("active", "Account can sign in", u?.active ?? true)}${formEnd("Save account")}</form>`,
  );
  $("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await action(
      "/api/users",
      {
        ...Object.fromEntries(f),
        id: u?.id,
        revision: openedRevision,
        active: f.has("active"),
      },
      "Account saved.",
      { close: true },
    );
  });
}
function confirmAction(title, description, callback, label = "Confirm") {
  openEditor(
    title,
    `<form id="confirmation-form"><p class="confirmation-copy">${esc(description)}</p>${formEnd(label)}`,
  );
  $("confirmation-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await callback();
  });
}
function explain() {
  openEditor(
    "A plan you can understand.",
    '<div class="explain-copy"><p>AI extracts donor messages into drafts. A human reviews missing facts. A deterministic planner then selects trips from approved, unreserved supply and demand.</p><ol><li>Exclude unapproved offers, unavailable volunteers, and declared allergen conflicts.</li><li>Require chilled capability, donor readiness, collection deadlines, donor use-by and transit limits, recipient windows, and driver shift limits.</li><li>Score feasible trips by urgency, priority, load size, travel distance, and scarce chilled capacity.</li><li>Update quantities and each driver’s position after every selection.</li><li>Independently audit the plan and recheck it when a coordinator confirms.</li></ol><p>Confirmation reserves stock. Pickup begins transport. Recipient receipt counts the meals as delivered. Cancelling releases only uncollected reservations.</p><p>The heuristic is not globally optimal. Routes use geographic straight-line distances at an assumed 24 km/h with 4-minute handovers; they are not road directions. Donor declarations are not an independent food-safety certificate.</p></div>',
  );
}
function download(name, value, type) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("navigation").addEventListener("click", (e) => {
  const b = e.target.closest("[data-nav]");
  if (b) navigate(b.dataset.nav);
});
$("page-content").addEventListener("submit", async (event) => {
  if (event.target.id !== "preview-form") return;
  event.preventDefault();
  if (state.comparing || state.busy) return;
  const form = event.target,
    session = state.session;
  const output = $("preview-result"),
    error = $("preview-error");
  const submit = form.querySelector('button[type="submit"]');
  state.comparing = true;
  submit.disabled = true;
  output.setAttribute("aria-busy", "true");
  error.textContent = "";
  try {
    const result = await api("/api/plans/preview", {
      volunteerId: form.elements.volunteerId.value,
      revision: state.data.revision,
    });
    if (session !== state.session) return;
    state.comparison = result;
    if (output.isConnected)
      output.innerHTML = window.RescueGuide.comparison(
        result,
        state.data.revision,
      );
  } catch (e) {
    if (session === state.session && error.isConnected)
      error.textContent = e.message;
  } finally {
    if (session === state.session) {
      state.comparing = false;
      if (state.view === "plans" && !form.isConnected) render();
    }
    submit.disabled = false;
    output.setAttribute("aria-busy", "false");
  }
});
$("page-content").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b || state.busy) return;
  const a = b.dataset.action;
  if (NAV.some((n) => n[0] === a)) return navigate(a);
  if (a === "new" || a === "edit")
    return editEntity(b.dataset.kind, b.dataset.id);
  if (a === "new-offer" || a === "new-request")
    return editEntity(a === "new-offer" ? "offers" : "requests");
  if (a === "new-user" || a === "edit-user") return editUser(b.dataset.id);
  if (a === "explain") return explain();
  if (a === "build") {
    const ok = await action(
      "/api/plans/build",
      {},
      "Draft built from current availability. Review before confirming.",
    );
    if (ok) navigate("plans");
  }
  if (a === "confirm")
    return confirmAction(
      "Confirm this rescue plan?",
      "This reserves the proposed stock, recipient demand, and volunteer schedule. Later changes require a fresh draft.",
      () =>
        action(
          "/api/plans/confirm",
          { id: b.dataset.id },
          "Plan confirmed. Assignments are available in each participant’s portal.",
          { close: true },
        ),
      "Confirm & reserve",
    );
  if (a === "select-plan") {
    state.selectedPlan = b.dataset.id;
    render();
  }
  if (a === "transition")
    return action(
      "/api/trips/transition",
      { id: b.dataset.id, planId: b.dataset.plan, status: b.dataset.status },
      "Delivery step recorded.",
    );
  if (a === "availability")
    return confirmAction(
      "Change volunteer availability?",
      b.dataset.active === "true"
        ? "This makes the volunteer eligible for new drafts. Cancelled assignments are not automatically restored."
        : "This releases all uncollected assignments for this volunteer. Food already in transit must be handed over first.",
      () =>
        action(
          "/api/volunteers/availability",
          { id: b.dataset.id, active: b.dataset.active === "true" },
          "Availability updated. Build a fresh draft for remaining meals.",
          { close: true },
        ),
    );
  if (a === "review") {
    openEditor(
      `${nice(b.dataset.status)} submission`,
      `<form id="review-form"><p class="confirmation-copy">Approval confirms that you have reviewed the declared details. Rejection keeps the record out of planning.</p><label for="review-note">Review note (optional)</label><textarea id="review-note" maxlength="1000" rows="3"></textarea>${formEnd(nice(b.dataset.status))}`,
    );
    $("review-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      await action(
        `/api/review/${b.dataset.kind}`,
        {
          id: b.dataset.id,
          status: b.dataset.status,
          note: $("review-note").value,
        },
        "Review decision saved.",
        { close: true },
      );
    });
  }
  if (a === "withdraw")
    return confirmAction(
      "Withdraw this record?",
      "Withdrawn offers and requests are excluded from future plans. Active reservations must be released before withdrawal.",
      () =>
        action(
          `/api/withdraw/${b.dataset.kind}`,
          { id: b.dataset.id },
          "Record withdrawn. Existing delivery history is preserved.",
          { close: true },
        ),
      "Withdraw record",
    );
  if (a === "delete")
    return confirmAction(
      "Delete this record?",
      "Only unlinked records can be removed. Records used by accounts or delivery history must be deactivated or cancelled instead.",
      () =>
        action(
          `/api/entities/${b.dataset.kind}`,
          { id: b.dataset.id },
          "Unlinked record deleted.",
          { close: true, method: "DELETE" },
        ),
      "Delete record",
    );
  if (a === "release")
    return confirmAction(
      "Release uncollected trips?",
      "All assigned or accepted trips across the network will be cancelled and their reservations released. In-transit food and completed deliveries stay intact. This prevents later routes relying on cancelled stops.",
      () =>
        action(
          "/api/plans/release",
          {},
          "Uncollected reservations released. Build a fresh draft.",
          { close: true },
        ),
      "Release uncollected reservations",
    );
  if (a === "export") {
    try {
      download(
        "rescueroute-report.json",
        JSON.stringify(await api("/api/export"), null, 2),
        "application/json",
      );
      toast("Report exported without passwords or API secrets.");
    } catch (e) {
      toast(e.message);
    }
  }
  if (a === "csv") {
    const cell = (s) =>
      `"${String(s)
        .replace(/^[=+@\-\t\r]/, "'$&")
        .replaceAll('"', '""')}"`;
    const rows = [
      ["Donor", "Offered", "Reserved", "Delivered"],
      ...state.data.donors.map((d) => {
        const offers = state.data.offers.filter((o) => o.donorId === d.id);
        return [
          d.name,
          ...["meals", "reserved", "delivered"].map((key) =>
            offers.reduce((n, o) => n + o[key], 0),
          ),
        ];
      }),
    ];
    download(
      "rescueroute-donors.csv",
      rows.map((r) => r.map(cell).join(",")).join("\r\n"),
      "text/csv;charset=utf-8",
    );
  }
  if (a === "reset") {
    openEditor(
      "Reset the local demo?",
      `<form id="reset-form"><p class="confirmation-copy">This replaces all local operational records and accounts with the original fictional demo. Existing sessions will be signed out. Export your records first.</p>${field("confirm", "Type RESET DEMO", "", "text", 'required autocomplete="off"')}${field("password", "Current administrator password", "", "password", 'required autocomplete="current-password"')}${formEnd("Reset demo & sign out")}`,
    );
    $("reset-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.busy) return;
      state.busy = true;
      const form = event.currentTarget;
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await api("/api/reset", Object.fromEntries(new FormData(form)));
        $("editor").close();
        showLogin();
        toast("Demo reset. Sign in with the original demo credentials.");
      } catch (e) {
        if ($("form-error")) $("form-error").textContent = e.message;
        else toast(e.message);
      } finally {
        state.busy = false;
        submit.disabled = false;
      }
    });
  }
});
$("page-content").addEventListener("input", (e) => {
  if (e.target.id === "record-search") {
    state.query = e.target.value;
    const cursor = e.target.selectionStart;
    const kind = state.view;
    const tbody = $("page-content").querySelector("tbody");
    tbody.innerHTML = entityRows(kind).join("");
    const emptyEl = $("page-content").querySelector(".table-wrap .empty-state");
    if (emptyEl) emptyEl.hidden = !!tbody.children.length;
    e.target.setSelectionRange?.(cursor, cursor);
  }
});
$("page-content").addEventListener("change", (e) => {
  if (["record-filter", "trip-filter"].includes(e.target.id)) {
    state.filter = e.target.value;
    render();
  }
});
$("page-content").addEventListener("submit", async (e) => {
  if (e.target.id !== "settings-form") return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  await action(
    "/api/settings",
    { ...f, now: minutes(f.now) },
    "Settings saved.",
  );
});
$("close-editor").addEventListener("click", () => $("editor").close());
$("refresh-button").addEventListener("click", async () => {
  try {
    await refresh();
    toast("Workspace refreshed.");
  } catch (e) {
    toast(e.message);
  }
});
$("logout-button").addEventListener("click", async () => {
  try {
    await stopGps(false);
    await stopDemo(false);
    await api("/api/logout", {});
    showLogin();
  } catch (e) {
    toast(e.message);
  }
});
$("fill-demo").addEventListener("click", () => {
  $("login-email").value = `${$("demo-account").value}@demo.rescueroute.test`;
  $("login-password").value = "RescueDemo!2026";
  $("login-error").textContent = "";
});
$("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = e.currentTarget.querySelector("button");
  b.disabled = true;
  $("login-error").textContent = "";
  try {
    state.session = await api("/api/login", {
      email: $("login-email").value,
      password: $("login-password").value,
    });
    $("login-password").value = "";
    state.view = "overview";
    state.query = "";
    state.filter = "";
    await refresh();
  } catch (error) {
    $("login-error").textContent = error.message;
  } finally {
    b.disabled = false;
  }
});

const { startLive, stopLiveResources, mountNetwork, stopGps, stopDemo } =
  window.createRescueLive({
    state,
    api,
    renderShell,
    render,
    showLogin,
    toast,
    $,
  });

async function start() {
  try {
    state.session = await api("/api/session");
    await refresh();
  } catch (e) {
    showLogin();
    if (e.status !== 401)
      $("login-error").textContent = `Unable to connect: ${e.message}`;
  }
}
fetch("/api/config")
  .then((r) => r.json())
  .then((config) => {
    if (config.deployment?.isolated) {
      $("deployment-note").hidden = false;
      $("deployment-note").textContent =
        "Public evaluation demo: your workspace is isolated to this browser. Data is temporary and resets after inactivity or a server restart. Use fictional information.";
    }
  })
  .catch(() => {});
start();
