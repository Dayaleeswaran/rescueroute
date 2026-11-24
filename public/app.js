import { clock, auditPlan } from "/lib/planner.mjs";

const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const state = {
  scenario: null,
  plan: null,
  view: "overview",
  approved: false,
  busy: false,
  mode: "local",
};
let toastTimer;
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 5500);
}
async function api(path, data) {
  const response = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok)
    throw new Error(result.error || "Request failed. Please try again.");
  return result;
}
const byId = (kind, id) => state.scenario[kind].find((item) => item.id === id);
function invalidate() {
  state.plan = null;
  state.approved = false;
}

function renderMetrics() {
  const s = state.scenario,
    p = state.plan;
  const total = s.offers.reduce((n, o) => n + o.meals, 0);
  const needs = s.requests.reduce((n, r) => n + r.meals, 0);
  const items = [
    [
      "Meals available",
      total,
      "meals",
      `${s.offers.length} donors ready to make a difference`,
      "♧",
    ],
    [
      "Meals allocated",
      p ? p.metrics.allocated : "—",
      p ? "meals" : "",
      p
        ? `${Math.round((p.metrics.allocated / total) * 100)}% of available meals matched`
        : "Build a plan to find their next stop",
      "↗",
    ],
    [
      "Recipient needs",
      p ? needs - p.metrics.allocated : needs,
      "meals",
      `${s.requests.length} community organisations`,
      "⌂",
    ],
    [
      "Available volunteers",
      s.volunteers.filter((v) => v.active).length,
      "people",
      p
        ? `${p.metrics.km} km estimated across ${p.metrics.trips} trips`
        : "Good people. Ready to go.",
      "♙",
    ],
  ];
  $("metrics").innerHTML = items
    .map(
      ([title, value, unit, note, icon]) =>
        `<article class="metric"><div class="metric-top">${title}<span class="metric-icon" aria-hidden="true">${icon}</span></div><div class="metric-value">${value}<small>${unit}</small></div><p class="metric-note">${note}</p></article>`,
    )
    .join("");
}
function renderMap() {
  const point = (p) => [45 + p[0] * 42, 20 + p[1] * 23];
  const xy = (p) => point(p).join(",");
  const grid = [50, 120, 195, 275, 350, 430, 510]
    .map((x) => `<path class="map-road-minor" d="M${x} 0L${x - 25} 300"/>`)
    .join("");
  const routes = (state.plan?.assignments || [])
    .map(
      (a) =>
        `<polyline class="route ${a.volunteerId === "v2" ? "second" : ""}" points="${xy(a.from)} ${xy(byId("offers", a.offerId).point)} ${xy(byId("requests", a.requestId).point)}"><title>${escape(byId("volunteers", a.volunteerId).name)}: ${a.meals} meals · collection ${clock(a.pickup)} · delivery ${clock(a.delivery)}</title></polyline>`,
    )
    .join("");
  const marker = (item, fill, label, index) => {
    const [x, y] = point(item.point);
    return `<g><title>${escape(item.name)} · ${label}</title><circle class="map-marker" cx="${x}" cy="${y}" r="12" fill="${fill}"/><text class="map-index" x="${x}" y="${y}">${index}</text><text class="map-label" x="${x}" y="${y + (index === "R" ? -19 : 26)}" text-anchor="middle">${escape(item.name.split(" ").slice(0, 2).join(" "))}</text></g>`;
  };
  $("map").innerHTML =
    `<svg viewBox="0 0 580 290" role="img" aria-label="Schematic rescue network in a fictional city. The trip list below provides route details."><rect width="580" height="290" fill="#eef0e7"/><path d="M355 0H425V75H355zM25 180H105V265H25zM210 95h75v60h-75z" fill="#e1e8d3"/>${grid}<path class="map-road-minor" d="M0 50H580M0 120H580M0 205H580M0 265H580"/><path class="map-river" d="M-20 280C105 155 180 265 290 165S475 140 610 35"/><path class="map-road" d="M0 90L580 185M160 0L270 290"/><text x="45" y="33" class="map-area">MARKET QUARTER</text><text x="383" y="34" class="map-area">NORTHSIDE</text><text x="350" y="260" class="map-area">HARBOR CITY</text>${routes}${state.scenario.volunteers
      .filter((v) => v.active)
      .map((v) => marker(v, "#7a8b9c", "Volunteer", "V"))
      .join(
        "",
      )}${state.scenario.offers.map((o, i) => marker(o, "#d28d59", "Donor", i + 1)).join("")}${state.scenario.requests.map((r) => marker(r, "#416d53", "Recipient", "R")).join("")}</svg>`;
}
function renderEntities() {
  const view = state.view;
  const kind =
    view === "requests"
      ? "requests"
      : view === "volunteers"
        ? "volunteers"
        : "offers";
  const labels = {
    offers: ["Available food offers", "Good food looking for its next stop."],
    requests: [
      "Recipient needs",
      "Declared requirements for this rescue window.",
    ],
    volunteers: [
      "Your volunteer network",
      "Capacity, availability, and transport capabilities.",
    ],
  };
  [$("list-title").textContent, $("list-subtitle").textContent] = labels[kind];
  $("view-all").hidden = view !== "overview";
  $("entity-list").innerHTML = state.scenario[kind]
    .map((item, i) => {
      let description, tags, amount, unit;
      if (kind === "offers") {
        description = item.food;
        tags = `<span class="tag ${item.deadline - state.scenario.now <= 40 ? "warning" : ""}">◷ Collect by ${clock(item.deadline)}</span><span class="tag">${item.handling === "chilled" ? "Chilled transport" : "Ambient transport"}</span><span>${item.allergens.length ? escape(item.allergens.join(", ")) : "No allergens declared"}</span>`;
        amount = item.meals;
        unit = "meals";
      } else if (kind === "requests") {
        description = `Accepts deliveries until ${clock(item.deadline)}`;
        tags = `<span class="tag">Priority ${item.priority}/3</span><span>${item.excludes.length ? `Excludes ${escape(item.excludes.join(", "))}` : "No allergen exclusions declared"}</span>`;
        amount = item.meals;
        unit = "requested";
      } else {
        description = `${item.vehicle} · ${clock(item.available)}–${clock(item.until)}`;
        tags = `<span class="tag ${item.active ? "" : "warning"}">${item.active ? "Available" : "Cancelled"}</span><span>${item.chilled ? "Chilled capable" : "Ambient transport only"}</span>`;
        amount = item.capacity;
        unit = "meals / trip";
      }
      return `<article class="entity-row"><div class="food-symbol ${["green", "orange", ""][i % 3]}" aria-hidden="true">${kind === "offers" ? ["♧", "▱", "♧"][i % 3] : kind === "requests" ? "⌂" : "♙"}</div><div class="entity-details"><h3>${escape(item.name)}</h3><p>${escape(description)}</p><div class="entity-meta">${tags}</div></div><div class="entity-quantity"><strong>${amount}</strong><small>${unit}</small></div></article>`;
    })
    .join("");
}
function renderVolunteers() {
  $("volunteer-count").textContent = state.scenario.volunteers.filter(
    (v) => v.active,
  ).length;
  $("volunteer-list").innerHTML = state.scenario.volunteers
    .map(
      (v) =>
        `<div class="volunteer-row"><span class="avatar">${escape(v.initials)}</span><div><strong>${escape(v.name)}</strong><small>${escape(v.vehicle)} · ${v.capacity} meals / trip</small></div><span class="availability ${v.active ? "" : "cancelled"}">${v.active ? "Available" : "Cancelled"}</span></div>`,
    )
    .join("");
  $("cancel-volunteer").textContent = byId("volunteers", "v2").active
    ? "Simulate Alex cancelling ↻"
    : "Restore Alex’s availability ↻";
}
function renderPlan() {
  $("plan-panel").hidden = !state.plan;
  if (!state.plan) return;
  const p = state.plan;
  $("plan-state").textContent = state.approved
    ? "Confirmed in this session"
    : "Draft · review required";
  $("plan-subtitle").textContent =
    `${p.metrics.allocated} meals allocated · ${p.metrics.trips} trips · ${p.metrics.km} estimated km`;
  $("confirm-plan").disabled = state.approved;
  $("confirm-plan").textContent = state.approved
    ? "✓ Plan confirmed"
    : "Confirm this plan";
  $("plan-list").innerHTML =
    (p.assignments.length
      ? p.assignments
          .map(
            (a, i) =>
              `<article class="trip"><div class="trip-top"><span class="trip-number">${i + 1}</span><h3>${escape(byId("offers", a.offerId).name)} <span>→</span> ${escape(byId("requests", a.requestId).name)}</h3></div><p class="trip-meta"><strong>${a.meals} meals</strong> · ${escape(byId("volunteers", a.volunteerId).name)} · Collect ${clock(a.pickup)} · Deliver ${clock(a.delivery)} · ${a.km.toFixed(1)} km</p><p class="trip-reason">${escape(a.reason)}</p></article>`,
          )
          .join("")
      : '<div class="empty-state">No feasible deliveries were found.<br>Review the unmet needs and available transport.</div>') +
    p.unallocated
      .map(
        (u) =>
          `<div class="unallocated"><strong>${u.meals} meals unallocated · ${escape(byId("offers", u.offerId).name)}</strong><br>${escape(u.reason)}</div>`,
      )
      .join("") +
    (p.unmet.length
      ? `<div class="fine-print"><strong>Remaining needs:</strong> ${p.unmet.map((u) => `${escape(byId("requests", u.requestId).name)}: ${u.meals} meals`).join(" · ")}</div>`
      : "");
}
function renderAssistant() {
  const p = state.plan;
  if (!p)
    $("assistant-message").innerHTML =
      `There are <strong>${state.scenario.offers.reduce((n, o) => n + o.meals, 0)} meals</strong> available across your network. Let’s find them a destination.`;
  else
    $("assistant-message").innerHTML =
      `<strong>${p.metrics.allocated} meals have a proposed destination.</strong> ${p.unallocated.length ? `${p.unallocated.reduce((n, u) => n + u.meals, 0)} remain unallocated. Review the reasons in your plan.` : "Every available meal is allocated within the declared constraints."} ${state.approved ? "You have confirmed this version." : "Review the trips before confirming."}`;
  $("generate").innerHTML =
    `<span aria-hidden="true">✳</span> ${p ? "Rebuild rescue plan" : "Build rescue plan"} <span aria-hidden="true">↗</span>`;
}
function render() {
  $("offer-count").textContent = state.scenario.offers.length;
  renderMetrics();
  renderMap();
  renderEntities();
  renderVolunteers();
  renderPlan();
  renderAssistant();
}
async function buildPlan({ focus = true, message } = {}) {
  if (state.busy) return;
  state.busy = true;
  for (const id of [
    "generate",
    "cancel-volunteer",
    "reset-demo",
    "open-intake",
  ])
    $(id).disabled = true;
  $("generate").textContent = "Checking rescue constraints…";
  try {
    const next = await api("/api/plan", state.scenario);
    if (auditPlan(state.scenario, next).length)
      throw new Error("Plan failed its independent feasibility check.");
    state.plan = next;
    state.approved = false;
    render();
    toast(
      message ||
        `${next.metrics.allocated} meals allocated. Your draft is ready to review.`,
    );
    if (focus)
      $("plan-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    toast(error.message);
    renderAssistant();
  } finally {
    state.busy = false;
    for (const id of [
      "generate",
      "cancel-volunteer",
      "reset-demo",
      "open-intake",
    ])
      $(id).disabled = false;
  }
}
function setView(view) {
  state.view = view;
  const labels = {
    overview: [
      "Overview",
      "Every meal has somewhere to go.",
      "A little coordination. A lot less food going to waste.",
    ],
    offers: [
      "Food offers",
      "Good food. Ready for a second chance.",
      "Review surplus food and collection requirements.",
    ],
    requests: [
      "Recipient needs",
      "Start with what people need.",
      "Match food with declared needs and dietary restrictions.",
    ],
    volunteers: [
      "Volunteers",
      "The people behind every rescue.",
      "A realistic plan starts with available people and transport.",
    ],
    plan: [
      "Rescue plan",
      "A route from surplus to purpose.",
      "Review each trip, its constraints, and what remains unmatched.",
    ],
  };
  const [label, title, description] = labels[view];
  $("breadcrumb").textContent = label;
  $("page-title").textContent = title;
  $("page-description").textContent = description;
  document.querySelectorAll("[data-view]").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === view);
    if (b.dataset.view === view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  $("map-panel").hidden = !["overview", "plan"].includes(view);
  $("list-panel").hidden = view === "plan";
  renderEntities();
  if (view === "plan" && !state.plan)
    toast("Build a rescue plan to see proposed deliveries.");
}
function info(content, title = "A plan you can understand.") {
  $("info-title").textContent = title;
  $("info-body").innerHTML = content;
  $("info-dialog").showModal();
}
$("explain-button").addEventListener("click", () =>
  info(
    "<p>The planner checks every possible donor, recipient, and volunteer combination, then selects feasible trips using a repeatable scoring rule.</p><ol><li>Only donor-confirmed offers are eligible.</li><li>Declared allergens must match recipient restrictions, and chilled food needs a capable vehicle.</li><li>Travel, collection, delivery, and the volunteer’s shift must fit the available time.</li><li>The score favours soon-closing offers, higher-priority requests, fuller loads, and shorter travel. It also preserves chilled vehicles when chilled offers exist.</li><li>Stock and recipient demand are reduced after each allocation. A volunteer starts their next trip after completing the previous one.</li></ol><h3>Transparent limits</h3><p>This is a greedy heuristic, not a guarantee of the best possible allocation. Distances use a fictional grid at an assumed 24 km/h, with four minutes each for pickup and handover. Food suitability and handling are donor-provided, and require human verification.</p>",
  ),
);
$("help-button").addEventListener("click", () =>
  info(
    "<p>RescueRoute is a working food-rescue planning prototype. All locations, organisations, and volunteers here are fictional.</p><h3>Try the demonstration</h3><ol><li>Build a rescue plan and review the proposed trips.</li><li>Simulate Alex cancelling. Notice how chilled transport becomes unavailable.</li><li>Restore Alex, or add a reviewed food offer, and rebuild.</li><li>Confirm the plan and export its evidence.</li></ol><p>Live AI intake is optional. Without an API key, the clearly labelled local parser extracts a limited set of explicit fields. The allocation engine works in both modes.</p><p>Data stays in this session. Reloading resets the demo. No deliveries are dispatched.</p>",
    "Welcome to RescueRoute.",
  ),
);
$("close-info").addEventListener("click", () => $("info-dialog").close());
$("generate").addEventListener("click", () => buildPlan());
$("cancel-volunteer").addEventListener("click", async () => {
  if (state.busy) return;
  const v = byId("volunteers", "v2");
  v.active = !v.active;
  const previous = state.plan?.metrics.allocated;
  invalidate();
  render();
  await buildPlan({
    focus: false,
    message: v.active
      ? "Alex is back. The plan has been rebuilt with chilled transport available."
      : `Alex cancelled. The plan has been rebuilt${previous === undefined ? "" : ` from a previous allocation of ${previous} meals`}. Review unallocated meals below.`,
  });
});
document
  .querySelectorAll("[data-view]")
  .forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
$("view-all").addEventListener("click", () => setView("offers"));
$("confirm-plan").addEventListener("click", () => {
  if (!state.plan || !state.plan.assignments.length)
    return toast("There are no feasible trips to confirm.");
  if (auditPlan(state.scenario, state.plan).length)
    return toast("The plan is stale. Rebuild it before confirming.");
  state.approved = true;
  render();
  toast("Plan confirmed for this session. Export it to keep a record.");
});
$("export-plan").addEventListener("click", () => {
  if (!state.plan) return;
  const payload = {
    app: "RescueRoute",
    demo: true,
    status: state.approved ? "confirmed-in-session" : "draft",
    exportedAt: new Date().toISOString(),
    assumptions: {
      city: "Fictional local grid",
      speedKmh: 24,
      serviceMinutesPerStop: 4,
      optimality: "Greedy heuristic; not guaranteed optimal",
      handling: "Donor-declared, not independently certified",
    },
    scenario: state.scenario,
    plan: state.plan,
    validationErrors: auditPlan(state.scenario, state.plan),
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "rescueroute-plan.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Plan exported with assumptions and feasibility results.");
});
$("reset-demo").addEventListener("click", async () => {
  if (state.busy) return;
  try {
    state.scenario = await api("/api/scenario");
    invalidate();
    setView("overview");
    render();
    toast("Demo reset. All sample offers and volunteers are restored.");
  } catch (e) {
    toast(e.message);
  }
});
$("open-intake").addEventListener("click", () => {
  $("offer-form").reset();
  $("donor-message").value = "";
  $("intake-result").hidden = true;
  $("offer-error").textContent = "";
  $("intake-dialog").showModal();
});
$("close-intake").addEventListener("click", () => $("intake-dialog").close());
$("sample-message").addEventListener("click", () => {
  $("donor-message").value =
    "Donor: Central Market Deli\nFood: Roasted vegetable meal boxes\nWe have 15 meals available. Collect by 17:30.\nHandling: ambient\nAllergens: none";
});
$("analyse-message").addEventListener("click", async () => {
  const button = $("analyse-message");
  button.disabled = true;
  button.textContent = "Reading message…";
  $("intake-result").hidden = false;
  $("intake-result").textContent = "Extracting explicitly stated details…";
  try {
    const result = await api("/api/intake", {
      message: $("donor-message").value,
    });
    $("offer-form").reset();
    const d = result.draft;
    for (const [field, key] of [
      ["donor-name", "name"],
      ["food-name", "food"],
      ["meal-count", "meals"],
      ["collection-deadline", "deadline"],
      ["food-handling", "handling"],
    ])
      $(field).value = d[key] ?? "";
    $("food-allergens").value =
      d.allergens === null
        ? ""
        : d.allergens.length
          ? d.allergens.join(", ")
          : "none";
    $("intake-result").innerHTML =
      `<strong>${result.mode === "live" ? "AI draft" : "Local parser draft · AI is not connected"}</strong><p>${escape(result.notice)}</p>${result.questions.length ? `<ul>${result.questions.map((q) => `<li>${escape(q)}</li>`).join("")}</ul>` : ""}<p>Choose the collection location below. All fields still require your review.</p>`;
  } catch (e) {
    $("intake-result").textContent = e.message;
  } finally {
    button.disabled = false;
    button.textContent = "Extract offer details ✳";
  }
});
$("offer-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const error = $("offer-error");
  error.textContent = "";
  const name = $("donor-name").value.trim(),
    food = $("food-name").value.trim();
  const meals = Number($("meal-count").value);
  const time = $("collection-deadline").value.split(":").map(Number);
  const deadline = time[0] * 60 + time[1];
  const allergensText = $("food-allergens").value.trim();
  const allergens = /^none$/i.test(allergensText)
    ? []
    : allergensText
        .split(",")
        .map((a) => a.trim().toLowerCase())
        .filter(Boolean);
  if (
    !name ||
    !food ||
    !Number.isInteger(meals) ||
    meals < 1 ||
    meals > 1000 ||
    !Number.isFinite(deadline) ||
    deadline <= state.scenario.now ||
    !allergensText ||
    allergens.length > 16 ||
    !["ambient", "chilled"].includes($("food-handling").value) ||
    !$("food-location").value ||
    !$("verified-offer").checked
  ) {
    error.textContent =
      "Complete all fields, confirm donor details, and use a collection deadline after 16:00.";
    return;
  }
  if (state.scenario.offers.length >= 30) {
    error.textContent =
      "The demo supports up to 30 offers. Reset it to try another scenario.";
    return;
  }
  if (
    state.scenario.offers.some(
      (o) =>
        o.name.toLowerCase() === name.toLowerCase() &&
        o.food.toLowerCase() === food.toLowerCase() &&
        o.deadline === deadline,
    )
  ) {
    error.textContent =
      "This donor, food, and deadline already exist. Review the existing offer to avoid double-counting.";
    return;
  }
  const offer = {
    id: crypto.randomUUID(),
    name,
    food,
    meals,
    ready: state.scenario.now,
    deadline,
    allergens,
    handling: $("food-handling").value,
    verified: true,
    point: $("food-location").value.split(",").map(Number),
  };
  const next = structuredClone(state.scenario);
  next.offers.push(offer);
  state.busy = true;
  const submit = $("offer-form").querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    // Validate the entire candidate scenario on the server before changing client state.
    await api("/api/plan", next);
    state.scenario = next;
    invalidate();
    render();
    $("intake-dialog").close();
    toast(`${name} added. Rebuild the plan to include this reviewed offer.`);
  } catch (e) {
    error.textContent = e.message;
  } finally {
    state.busy = false;
    submit.disabled = false;
  }
});
async function start() {
  try {
    const [scenario, status] = await Promise.all([
      api("/api/scenario"),
      api("/api/status"),
    ]);
    state.scenario = scenario;
    state.mode = status.intake;
    $("intake-mode").textContent =
      status.intake === "live"
        ? "AI intake connected · planning verified"
        : "Local intake · no AI key required";
    $("mode-description").textContent =
      status.intake === "live"
        ? "AI extracts a draft from your message. The message is sent to OpenAI; use fictional data for this demo. Review every field before adding."
        : "Local demo mode: a limited parser extracts explicit quantities, deadlines, and labelled fields. Use the sample or enter details manually. No message is sent to an AI provider.";
    setView("overview");
    render();
  } catch (e) {
    toast(`Could not load RescueRoute: ${e.message}`);
    $("page-description").textContent =
      "The server could not be reached. Restart the app and reload this page.";
  }
}
start();
