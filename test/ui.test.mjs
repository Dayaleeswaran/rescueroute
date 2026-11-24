import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";
import { createApp } from "../server.mjs";

// DOM integration tests exercise real HTTP and app event handlers. They do not
// test rendering, layout, focus behaviour, or a screen reader.
async function harness(t) {
  const server = createApp({ aiKey: "" });
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

test("UI supports every administrator panel, profile creation, offer submission and approval", async (t) => {
  const h = await harness(t);
  await h.signIn("admin");
  for (const nav of [
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
    () => h.q("#extract-result").textContent.includes("Local parser draft"),
    "local extraction",
  );
  assert.equal(h.q("#field-meals").value, "15");
  assert.match(h.q("#field-food").value, /<img/);
  assert.equal(h.w.document.querySelector("#editor img"), null);
  assert.equal(h.q('[name="donorConfirmed"]').checked, false);
  assert.deepEqual(h.errors, []);
});
