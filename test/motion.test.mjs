import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

async function motion(
  t,
  { reduced = false, supported = true, intro = false, seen = false } = {},
) {
  const dom = new JSDOM(
    await readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    {
      url: "https://demo.rescueroute.test",
      runScripts: "outside-only",
    },
  );
  t.after(() => dom.window.close());
  const w = dom.window,
    animations = [];
  let change;
  const media = {
    matches: reduced,
    addEventListener: (_event, callback) => {
      change = callback;
    },
  };
  w.matchMedia = () => media;
  let deadline;
  if (!intro || seen)
    w.sessionStorage.setItem("rescueroute.intro.seen", "true");
  else {
    w.HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
      this.querySelector("button").focus();
    };
    w.HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
      this.dispatchEvent(new w.Event("close"));
    };
    w.setTimeout = (callback) => {
      deadline = callback;
      return 1;
    };
    w.clearTimeout = () => {
      deadline = null;
    };
  }
  if (supported)
    w.Element.prototype.animate = function () {
      let reject;
      const finished = new Promise((_resolve, rejectPromise) => {
        reject = rejectPromise;
      });
      const animation = {
        finished,
        cancelled: false,
        cancel() {
          this.cancelled = true;
          reject(Error("Cancelled"));
        },
      };
      animations.push(animation);
      return animation;
    };
  w.eval(
    await readFile(
      new URL("../public/rescue-motion.js", import.meta.url),
      "utf8",
    ),
  );
  const root = w.document.getElementById("page-content");
  root.innerHTML = '<div class="page-heading"><h1>Rescue planner</h1></div>';
  return {
    w,
    root,
    media,
    animations,
    change: () => change(),
    deadline: () => deadline?.(),
  };
}

test("system reduced motion is applied at startup and changing it cancels active movement", async (t) => {
  const h = await motion(t, { reduced: true });
  h.w.RescueMotion.login();
  assert.equal(h.animations.length, 0);
  assert.equal(h.w.document.documentElement.dataset.motion, "off");
  assert.ok(
    [...h.w.document.querySelectorAll("[data-motion-toggle]")].every(
      (b) => b.disabled,
    ),
  );
  h.media.matches = false;
  h.change();
  h.w.document.getElementById("workspace").hidden = false;
  h.w.RescueMotion.page(h.root);
  assert.ok(h.animations.length > 0);
  h.media.matches = true;
  h.change();
  assert.ok(h.animations.every((animation) => animation.cancelled));
  assert.equal(
    h.w.document.querySelector('#login-form button[type="submit"]').disabled,
    false,
  );
});

test("the motion preference is shared across controls and user interaction settles entry effects", async (t) => {
  const h = await motion(t);
  h.w.document.getElementById("login-email").value = "donor@example.test";
  h.w.RescueMotion.login();
  assert.ok(h.animations.length > 0);
  h.w.document.dispatchEvent(
    new h.w.KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
  );
  assert.ok(h.animations.every((animation) => animation.cancelled));
  h.w.document.querySelector("[data-motion-toggle]").click();
  assert.equal(h.w.document.documentElement.dataset.motion, "off");
  assert.ok(
    [...h.w.document.querySelectorAll("[data-motion-toggle]")].every(
      (b) => b.getAttribute("aria-pressed") === "true",
    ),
  );
  assert.equal(h.w.localStorage.getItem("rescueroute.reduce-motion"), "true");
  assert.equal(
    h.w.document.getElementById("login-email").value,
    "donor@example.test",
  );
  assert.equal(
    h.w.document.querySelector('#login-form button[type="submit"]').disabled,
    false,
  );
});

test("unsupported animation APIs leave sign-in and motion controls usable", async (t) => {
  const h = await motion(t, { supported: false });
  assert.doesNotThrow(() => h.w.RescueMotion.login());
  assert.doesNotThrow(() => h.w.RescueMotion.workspace());
  h.w.document.querySelector("[data-motion-toggle]").click();
  assert.equal(h.w.document.documentElement.dataset.motion, "off");
  assert.equal(h.w.document.getElementById("login-screen").hidden, false);
});

test("first-visit card intro is skippable and restores usable sign-in focus", async (t) => {
  const h = await motion(t, { intro: true });
  const dialog = h.w.document.getElementById("brand-intro");
  assert.equal(dialog.open, true);
  assert.equal(h.w.document.activeElement.id, "skip-intro");
  h.w.document.getElementById("skip-intro").click();
  assert.equal(dialog.open, false);
  assert.equal(h.w.sessionStorage.getItem("rescueroute.intro.seen"), "true");
  assert.equal(h.w.document.activeElement.id, "login-email");
  assert.equal(
    h.w.document.querySelector('#login-form button[type="submit"]').disabled,
    false,
  );
});

test("card intro releases the modal even when its CSS completion event never arrives", async (t) => {
  const h = await motion(t, { intro: true });
  assert.equal(h.w.document.getElementById("brand-intro").open, true);
  h.deadline();
  assert.equal(h.w.document.getElementById("brand-intro").open, false);
});

test("Escape and CSS completion both finish the card intro without waiting for the deadline", async (t) => {
  for (const kind of ["cancel", "animationend"]) {
    const h = await motion(t, { intro: true });
    const dialog = h.w.document.getElementById("brand-intro");
    const event = new h.w.Event(kind, { bubbles: true, cancelable: true });
    if (kind === "animationend")
      Object.defineProperty(event, "animationName", { value: "intro-finish" });
    dialog.dispatchEvent(event);
    assert.equal(dialog.open, false);
  }
});

test("card intro never opens when the device requests reduced motion", async (t) => {
  const h = await motion(t, { intro: true, reduced: true });
  assert.equal(h.w.document.getElementById("brand-intro").open, false);
  assert.equal(h.w.sessionStorage.getItem("rescueroute.intro.seen"), "true");
});

test("a previously completed intro is not replayed in the same tab", async (t) => {
  const h = await motion(t, { intro: true, seen: true });
  assert.equal(h.w.document.getElementById("brand-intro").open, false);
  assert.equal(h.w.document.getElementById("login-screen").hidden, false);
});
