import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { DEMO_PASSWORD } from "../lib/auth.mjs";

export async function createDemoClient(origin, fetcher = fetch) {
  const target = new URL(origin);
  assert(target.protocol === "https:", "A public HTTPS origin is required.");
  const request = (path, options = {}) =>
    fetcher(target.origin + path, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  const jar = new Map();
  let csrf;
  const call = async (path, payload, originOverride) => {
    const response = await request(path, {
      ...(payload === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(payload) }),
      headers: {
        Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        "Content-Type": "application/json",
        Origin: originOverride || target.origin,
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      },
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";"),
        index = pair.indexOf("=");
      jar.set(pair.slice(0, index), pair.slice(index + 1));
      assert.match(cookie, /;\s*Secure/i, "Public cookie must be Secure.");
      assert.match(cookie, /;\s*HttpOnly/i, "Public cookie must be HttpOnly.");
      assert.match(
        cookie,
        /;\s*SameSite=Strict/i,
        "Public cookie must use SameSite=Strict.",
      );
    }
    const data = await response.json();
    return { status: response.status, data };
  };
  const login = await call("/api/login", {
    email: "admin@demo.rescueroute.test",
    password: DEMO_PASSWORD,
  });
  assert.equal(login.status, 200, "Public demo sign-in failed.");
  csrf = login.data.csrf;
  assert.equal(login.data.deployment.isolated, true);
  return call;
}

// Only run against an owner-authorised, disposable public-demo deployment.
export async function verifyDeployment(origin, fetcher = fetch) {
  const target = new URL(origin);
  assert(
    target.protocol === "https:" &&
      target.pathname === "/" &&
      !target.username &&
      !target.password &&
      !target.search &&
      !target.hash,
    "Supply the exact HTTPS origin with no path, credentials, or query.",
  );
  const request = async (path, options = {}) =>
    fetcher(target.origin + path, {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(12000),
    });
  const health = await request("/health");
  assert.equal(health.status, 200, "Health check failed.");
  const mode = await health.json();
  assert.equal(
    mode.mode,
    "public-demo",
    "Only disposable public-demo mode may be verified.",
  );
  for (const path of [
    "/",
    "/app.js",
    "/rescue-live.js",
    "/rescue-guide.js",
    "/vendor/leaflet/leaflet.js",
  ]) {
    const response = await request(path);
    assert.equal(response.status, 200, `Missing public asset: ${path}`);
    assert.match(
      response.headers.get("content-security-policy") || "",
      /frame-ancestors 'none'/,
    );
    await response.arrayBuffer();
  }
  const first = await createDemoClient(target.origin, fetcher),
    second = await createDemoClient(target.origin, fetcher);
  const before = (await first("/api/state")).data;
  const input = { revision: before.revision, volunteerId: "v2" };
  assert.equal(
    (await first("/api/plans/preview", input, "https://invalid.example"))
      .status,
    403,
  );
  const preview = await first("/api/plans/preview", input);
  assert.equal(preview.status, 200);
  assert.equal(preview.data.difference, -20);
  assert.equal((await first("/api/state")).data.revision, before.revision);
  const built = await first("/api/plans/build", {});
  assert.equal(built.status, 200);
  const draftState = (await first("/api/state")).data;
  const confirmation = await first("/api/plans/confirm", {
    id: built.data.result,
    revision: draftState.revision,
  });
  assert.equal(confirmation.status, 200);
  assert.equal((await first("/api/state")).data.totals.reserved, 80);
  const isolated = (await second("/api/state")).data;
  assert.equal(
    isolated.totals.reserved,
    0,
    "Visitor workspaces must be isolated.",
  );
  assert.equal(isolated.plans.length, 0);
  for (const call of [first, second]) {
    const reset = await call("/api/reset", {
      confirm: "RESET DEMO",
      password: DEMO_PASSWORD,
    });
    assert.equal(reset.status, 200, "Verifier workspace cleanup failed.");
  }
  return {
    origin: target.origin,
    mode: mode.mode,
    checksPassed: true,
    checks: [
      "health",
      "static assets and CSP",
      "secure cookies",
      "origin rejection",
      "read-only disruption preview",
      "reservation confirmation",
      "visitor isolation",
      "workspace cleanup",
    ],
    scope:
      "Owner-authorised disposable public demo; two synthetic workspaces. No GPS device, visual browser, screen reader, or production load verification.",
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    console.log(
      JSON.stringify(await verifyDeployment(process.argv[2]), null, 2),
    );
  } catch (error) {
    console.error(`Deployment verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
