import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

async function motion(t, { reduced = false, supported = true } = {}) {
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
  return { w, root, media, animations, change: () => change() };
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
