/**
 * @fileoverview RescueRoute browser client entry point: state, API transport,
 * action orchestration, DOM event wiring, and session bootstrap.
 */

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

let mountLiveNetwork = () => {};

const { NAV, renderShell, render, navigate, entityRows } =
  window.createAppViews({
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
    onMountNetwork: () => mountLiveNetwork(),
  });

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
    } else {
      toast(error.message);
    }
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

const { field, openEditor, formEnd, editEntity, editUser, confirmAction, explain } =
  window.createAppForms({
    $,
    esc,
    time,
    minutes,
    nice,
    state,
    managed,
    find,
    api,
    action,
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
mountLiveNetwork = mountNetwork;

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
  if (event.target.id === "settings-form") {
    event.preventDefault();
    const f = Object.fromEntries(new FormData(event.target));
    await action(
      "/api/settings",
      { ...f, now: minutes(f.now) },
      "Settings saved.",
    );
    return;
  }
  if (event.target.id !== "preview-form") return;
  event.preventDefault();
  if (state.comparing || state.busy) return;
  const form = event.target;
  const session = state.session;
  const output = $("preview-result");
  const error = $("preview-error");
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
    if (output.isConnected) {
      output.innerHTML = window.RescueGuide.comparison(
        result,
        state.data.revision,
      );
    }
  } catch (e) {
    if (session === state.session && error.isConnected) {
      error.textContent = e.message;
    }
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
    return;
  }
  if (a === "confirm") {
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
  }
  if (a === "select-plan") {
    state.selectedPlan = b.dataset.id;
    render();
    return;
  }
  if (a === "transition") {
    return action(
      "/api/trips/transition",
      { id: b.dataset.id, planId: b.dataset.plan, status: b.dataset.status },
      "Delivery step recorded.",
    );
  }
  if (a === "availability") {
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
  }
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
    return;
  }
  if (a === "withdraw") {
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
  }
  if (a === "delete") {
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
  }
  if (a === "release") {
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
  }
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
    return;
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
    return;
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

async function start() {
  try {
    state.session = await api("/api/session");
    await refresh();
  } catch (e) {
    showLogin();
    if (e.status !== 401) {
      $("login-error").textContent = `Unable to connect: ${e.message}`;
    }
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
