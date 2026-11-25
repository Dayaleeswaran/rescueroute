import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { createApp } from "../server.mjs";
import axe from "axe-core";

// DOM integration tests exercise real HTTP and app event handlers. They do not
// test rendering, layout, focus behaviour, or a screen reader.
async function harness(t, options = {}) {
  const server = createApp({ aiKey: "", ...options });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const errors = [],
    vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message));
  const dom = new JSDOM(
    await readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    { url: base, runScripts: "outside-only", virtualConsole: vc },
  );
  const w = dom.window;
  let cookie = "";
  w.fetch = async (path, options = {}) => {
    const headers = {
      ...options.headers,
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: base,
    };
    const response = await fetch(new URL(path, base), { ...options, headers });
    if (response.headers.has("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    return response;
  };
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  w.HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  w.eval(
    await readFile(
      new URL("../public/network-map.js", import.meta.url),
      "utf8",
    ),
  );
  w.eval(
    await readFile(
      new URL("../public/rescue-guide.js", import.meta.url),
      "utf8",
    ),
  );
  w.eval(
    await readFile(
      new URL("../public/rescue-live.js", import.meta.url),
      "utf8",
    ),
  );
  w.eval(await readFile(new URL("../public/app.js", import.meta.url), "utf8"));
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
    dom.window.close();
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const q = (selector) => {
    const el = w.document.querySelector(selector);
    assert.ok(el, `Missing UI element: ${selector}`);
    return el;
  };
  const wait = async (predicate, message) => {
    for (let i = 0; i < 120; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    throw new Error(
      `Timed out: ${message}. UI errors: ${errors.join("; ")}. Toast: ${w.document.querySelector("#toast")?.textContent}. Form: ${w.document.querySelector("#form-error")?.textContent}`,
    );
  };
  const click = (selector) => q(selector).click();
  const submit = (selector) =>
    q(selector).dispatchEvent(
      new w.Event("submit", { bubbles: true, cancelable: true }),
    );
  const value = (selector, text) => {
    q(selector).value = text;
  };
  async function signIn(account) {
    value("#demo-account", account);
    click("#fill-demo");
    submit("#login-form");
    await wait(
      () => !q("#workspace").hidden && q("#profile-name").textContent !== "",
      `sign in ${account}`,
    );
  }
  async function signOut() {
    click("#logout-button");
    await wait(() => !q("#login-screen").hidden, "sign out");
  }
  await wait(() => !q("#login-screen").hidden, "initial login");
  return { w, errors, q, wait, click, submit, value, signIn, signOut };
}

test("Gemini failure is visibly labelled as local fallback and preserves reviewed form fields", async (t) => {
  const h = await harness(t, {
    aiKey: "test-only",
    fetcher: async () => new Response("", { status: 401 }),
  });
  await h.signIn("donor");
  h.click('[data-nav="offers"]');
  h.click('[data-action="new"][data-kind="offers"]');
  h.value(
    "#intake-message",
    "Donor: Green Table\nFood: Rice bowls\n15 meals. Collect by 17:30.\nHandling: chilled\nAllergens: none",
  );
  h.click("#extract-offer");
  await h.wait(
    () => h.q("#extract-result").textContent.includes("Local contextual draft"),
    "Gemini fallback",
  );
  assert.match(h.q("#extract-result").textContent, /Gemini rejected/);
  assert.equal(h.q("#field-meals").value, "15");
  assert.equal(h.q("#extract-result").getAttribute("aria-busy"), "false");
  assert.equal(h.q('[name="donorConfirmed"]').checked, false);
  assert.match(h.q("#extract-result").textContent, /View the source facts/);
});

test("key admin views and offer form pass DOM-level WCAG checks (contrast excluded)", async (t) => {
  const h = await harness(t);
  await h.signIn("admin");
  h.w.eval(axe.source);
  const audit = async (name) => {
    const result = await h.w.axe.run(h.w.document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
      rules: { "color-contrast": { enabled: false } },
    });
    assert.equal(
      result.violations.length,
      0,
      `${name}: ${JSON.stringify(result.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target) })))}`,
    );
  };
  const views = [...h.w.document.querySelectorAll("[data-nav]")].map(
    (el) => el.dataset.nav,
  );
  for (const view of views) {
    h.click(`[data-nav="${view}"]`);
    await audit(view);
  }
  h.click('[data-nav="offers"]');
  h.click('[data-action="new"][data-kind="offers"]');
  await audit("offer form");
});

test("role changes leave administrator-only views and participant portals pass scoped semantic checks", async (t) => {
  const h = await harness(t);
  await h.signIn("admin");
  h.click('[data-nav="users"]');
  await h.signOut();
  for (const role of ["donor", "recipient", "volunteer", "coordinator"]) {
    await h.signIn(role);
    assert.notEqual(h.q("#breadcrumb").textContent, "User accounts");
    h.w.eval(axe.source);
    const views = [...h.w.document.querySelectorAll("[data-nav]")].map(
      (el) => el.dataset.nav,
    );
    for (const view of views) {
      h.click(`[data-nav="${view}"]`);
      const result = await h.w.axe.run(h.w.document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
        },
        rules: { "color-contrast": { enabled: false } },
      });
      assert.equal(
        result.violations.length,
        0,
        `${role}/${view}: ${JSON.stringify(result.violations.map((v) => v.id))}`,
      );
    }
    await h.signOut();
  }
});

test("guided rescue links to the real workflow and preview compares without changing availability", async (t) => {
  const h = await harness(t);
  await h.signIn("admin");
  h.click('[data-action="guide"]');
  assert.equal(h.w.document.querySelectorAll(".rescue-step").length, 5);
  assert.match(h.q("#page-content").textContent, /seeded fictional records/i);
  h.click('.rescue-step [data-action="plans"]');
  h.value("#preview-volunteer", "v2");
  h.submit("#preview-form");
  await h.wait(
    () => h.q("#preview-result").textContent.includes("20 fewer portions"),
    "disruption preview",
  );
  assert.match(
    h.q("#preview-result").textContent,
    /No active volunteer has chilled transport/,
  );
  assert.match(
    h.q("#preview-result").textContent,
    /no records, reservations, availability, or deliveries were changed/,
  );
  h.click('[data-action="build"]');
  await h.wait(
    () => h.q("#page-content").textContent.includes("80 meals"),
    "unchanged actual plan",
  );
  assert.match(
    h.q("#preview-result").textContent,
    /network changed after this comparison/i,
  );
});

test("participant guide uses the signed-in role and does not expose coordinator comparisons", async (t) => {
  const h = await harness(t);
  await h.signIn("donor");
  h.click('[data-nav="guide"]');
  assert.equal(h.w.document.querySelectorAll(".rescue-step").length, 3);
  assert.ok(!h.w.document.querySelector('[data-nav="plans"]'));
  h.click('.rescue-step [data-action="new-offer"]');
  assert.equal(h.q("#editor").open, true);
  assert.ok(h.q("#intake-message"));
});

test("page navigation moves DOM focus to the new page heading", async (t) => {
  const h = await harness(t);
  await h.signIn("coordinator");
  h.click('[data-nav="guide"]');
  assert.equal(h.w.document.activeElement, h.q("#page-content h1"));
  assert.match(h.w.document.activeElement.textContent, /step by step/);
  h.click('.rescue-step [data-action="plans"]');
  assert.equal(h.w.document.activeElement, h.q("#page-content h1"));
  assert.match(h.w.document.activeElement.textContent, /surplus to purpose/);
});

test("new intake clears unsupported old facts and revokes earlier donor confirmation", async (t) => {
  const h = await harness(t);
  await h.signIn("donor");
  h.click('[data-nav="offers"]');
  h.click('[data-action="new"][data-kind="offers"]');
  h.value("#field-meals", "50");
  h.value("#field-allergens", "none");
  h.q('[name="donorConfirmed"]').checked = true;
  h.value("#intake-message", "Food: Rice bowls");
  h.click("#extract-offer");
  await h.wait(
    () => h.q("#extract-result").textContent.includes("Local contextual draft"),
    "replacement intake",
  );
  assert.equal(h.q("#field-food").value, "Rice bowls");
  assert.equal(h.q("#field-meals").value, "");
  assert.equal(h.q("#field-allergens").value, "");
  assert.equal(h.q('[name="donorConfirmed"]').checked, false);
});

test("an intake response cannot update a replacement editor", async (t) => {
  let release,
    started = false;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const h = await harness(t, {
    aiKey: "test-only",
    fetcher: async () => {
      started = true;
      await blocked;
      return new Response("", { status: 401 });
    },
  });
  await h.signIn("donor");
  h.click('[data-nav="offers"]');
  h.click('[data-action="new"][data-kind="offers"]');
  h.click("#fill-sample");
  const oldOutput = h.q("#extract-result");
  h.click("#extract-offer");
  await h.wait(() => started, "provider request started");
  h.click("#close-editor");
  h.click('[data-action="new"][data-kind="offers"]');
  h.value("#field-meals", "9");
  release();
  await h.wait(
    () => oldOutput.getAttribute("aria-busy") === "false",
    "old request finished",
  );
  assert.equal(h.q("#field-meals").value, "9");
  assert.equal(h.q("#extract-result").textContent, "");
  assert.deepEqual(h.errors, []);
});

test("map entity selection exposes donor details and demo movement is visibly labelled", async (t) => {
  const h = await harness(t);
  await h.signIn("admin");
  h.click('[data-nav="network"]');
  h.click('[data-map-entity="donor:d1"]');
  assert.match(h.q("#network-selected").textContent, /Vegetable rice bowls/);
  assert.match(h.q("#network-selected").textContent, /Demo placement/);
  h.click('[data-map-entity="volunteer:v1"]');
  h.click("[data-demo-start]");
  await h.wait(
    () => h.q("#network-selected").textContent.includes("DEMO movement"),
    "demo marker update",
  );
  h.click("[data-demo-stop]");
  await h.wait(
    () => h.q("#gps-message").textContent.includes("Demo movement stopped"),
    "stop demo",
  );
  assert.deepEqual(h.errors, []);
});

test("GPS starts only on consent action and stopping waits for an in-flight fix before clearing it", async (t) => {
  const h = await harness(t);
  let callback,
    watches = 0,
    clears = 0;
  Object.defineProperty(h.w.navigator, "geolocation", {
    value: {
      watchPosition(fn) {
        watches++;
        callback = fn;
        return 7;
      },
      clearWatch(id) {
        assert.equal(id, 7);
        clears++;
      },
    },
    configurable: true,
  });
  await h.signIn("volunteer");
  h.click('[data-nav="network"]');
  assert.equal(watches, 0);
  h.click('[data-map-entity="volunteer:v1"]');
  h.click("[data-gps-start]");
  assert.equal(watches, 1);
  const before = await (await h.w.fetch("/api/state")).json();
  const pending = callback({
    coords: { latitude: 6.92, longitude: 79.91, accuracy: 15 },
  });
  h.click("[data-gps-stop]");
  await pending;
  await h.wait(
    () => h.q("#gps-message").textContent.includes("GPS sharing stopped"),
    "clear in-flight GPS",
  );
  const after = await (await h.w.fetch("/api/state")).json();
  assert.equal(after.mapData.entities.find((e) => e.id === "v1").fix, null);
  assert.equal(after.revision, before.revision);
  assert.equal(clears, 1);
  await callback({
    coords: { latitude: 6.93, longitude: 79.92, accuracy: 10 },
  });
  const late = await (await h.w.fetch("/api/state")).json();
  assert.equal(late.mapData.entities.find((e) => e.id === "v1").fix, null);
  assert.deepEqual(h.errors, []);
});

test("UI supports every administrator panel, profile creation, offer submission and approval", async (t) => {
  const h = await harness(t);
  await h.signIn("admin");
  for (const nav of [
    "network",
    "offers",
    "requests",
    "donors",
    "recipients",
    "volunteers",
    "approvals",
    "plans",
    "deliveries",
    "reports",
    "notifications",
    "audit",
    "users",
    "settings",
    "overview",
  ]) {
    h.click(`[data-nav="${nav}"]`);
    assert.ok(h.q("#page-content h1").textContent.length > 5);
  }
  h.click('[data-nav="donors"]');
  h.click('[data-action="new"][data-kind="donors"]');
  h.value("#field-name", "Demo Bistro");
  h.value("#field-contact", "bistro@example.test");
  h.submit("#record-form");
  await h.wait(() => !h.q("#editor").open, "save donor profile");
  assert.match(h.q("#page-content").textContent, /Demo Bistro/);
  h.click('[data-nav="offers"]');
  h.click('[data-action="new"][data-kind="offers"]');
  const option = [...h.q("#field-donorId").options].find(
    (o) => o.textContent === "Demo Bistro",
  );
  assert.ok(option);
  h.value("#field-donorId", option.value);
  h.value("#field-food", "Roasted vegetable bowls");
  h.value("#field-meals", "10");
  h.value("#field-handling", "ambient");
  h.value("#field-allergens", "none");
  h.q('[name="donorConfirmed"]').checked = true;
  h.submit("#record-form");
  await h.wait(() => !h.q("#editor").open, "save food offer");
  assert.match(h.q("#page-content").textContent, /Roasted vegetable bowls/);
  h.click('[data-nav="approvals"]');
  assert.match(h.q("#page-content").textContent, /Demo Bistro/);
  h.click('[data-action="review"][data-status="approved"]');
  h.submit("#review-form");
  await h.wait(() => !h.q("#editor").open, "approve submission");
  assert.match(h.q("#page-content").textContent, /review queue is clear/);
  assert.deepEqual(h.errors, []);
});

test("UI supports coordinator confirmation, volunteer handoff, and recipient receipt across accounts", async (t) => {
  const h = await harness(t);
  await h.signIn("admin");
  h.click('[data-nav="plans"]');
  h.click('[data-action="build"]');
  await h.wait(
    () => h.w.document.querySelector('[data-action="confirm"]'),
    "build draft",
  );
  assert.match(h.q(".plan-overview").textContent, /80 meals/);
  h.click('[data-action="confirm"]');
  h.submit("#confirmation-form");
  await h.wait(() => !h.q("#editor").open, "confirm plan");
  await h.signOut();
  await h.signIn("volunteer");
  assert.equal(h.w.document.querySelector('[data-nav="users"]'), null);
  h.click('[data-nav="deliveries"]');
  h.click('[data-action="transition"][data-status="accepted"]');
  await h.wait(
    () =>
      h.w.document.querySelector(
        '[data-action="transition"][data-status="picked_up"]',
      ),
    "accept trip",
  );
  h.click('[data-action="transition"][data-status="picked_up"]');
  await h.wait(
    () =>
      h.w.document.querySelector(
        '[data-action="transition"][data-status="awaiting_receipt"]',
      ),
    "collect food",
  );
  h.click('[data-action="transition"][data-status="awaiting_receipt"]');
  await h.wait(
    () => h.q("#page-content").textContent.includes("Awaiting receipt"),
    "arrive",
  );
  assert.equal(
    h.w.document.querySelector(
      '[data-action="transition"][data-status="delivered"]',
    ),
    null,
  );
  await h.signOut();
  await h.signIn("riverside");
  h.click('[data-nav="deliveries"]');
  h.click('[data-action="transition"][data-status="delivered"]');
  await h.wait(
    () => h.q("#page-content").textContent.includes("Delivered"),
    "recipient receipt",
  );
  h.click('[data-nav="overview"]');
  assert.match(h.q("#page-content").textContent, /Meals received/);
  assert.deepEqual(h.errors, []);
});

test("UI form fields safely render untrusted text and local intake leaves unknown facts for review", async (t) => {
  const h = await harness(t);
  await h.signIn("donor");
  h.click('[data-nav="offers"]');
  h.click('[data-action="new"][data-kind="offers"]');
  h.value(
    "#intake-message",
    "Food: <img src=x onerror=alert(1)>\n15 meals. Collect by 17:30.\nHandling: ambient\nAllergens: none",
  );
  h.click("#extract-offer");
  await h.wait(
    () => h.q("#extract-result").textContent.includes("Local contextual draft"),
    "local extraction",
  );
  assert.equal(h.q("#field-meals").value, "15");
  assert.match(h.q("#field-food").value, /<img/);
  assert.equal(h.w.document.querySelector("#editor img"), null);
  assert.equal(h.q('[name="donorConfirmed"]').checked, false);
  assert.deepEqual(h.errors, []);
});
