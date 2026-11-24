import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../server.mjs";
import { Database, seedDatabase } from "../lib/database.mjs";
import { DEMO_PASSWORD } from "../lib/auth.mjs";

async function application(t, database = new Database()) {
  const server = createApp({ aiKey: "", database });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}
async function login(base, account) {
  const r = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: `${account}@demo.rescueroute.test`,
      password: DEMO_PASSWORD,
    }),
  });
  assert.equal(r.status, 200);
  const data = await r.json();
  return {
    Cookie: r.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": data.csrf,
    "Content-Type": "application/json",
  };
}
test("HTTP boundaries enforce authentication, CSRF, origins, roles and file allowlists", async (t) => {
  const { base } = await application(t);
  assert.equal((await fetch(base)).status, 200);
  assert.equal((await fetch(base + "/api/state")).status, 401);
  const headers = await login(base, "admin");
  const post = (path, body, extra = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  const stateResponse = await fetch(base + "/api/state", { headers });
  assert.equal(stateResponse.status, 200);
  assert.match(
    stateResponse.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.ok(
    !JSON.stringify(await stateResponse.json()).includes("passwordHash"),
  );
  assert.equal(
    (await post("/api/plans/build", {}, { "X-CSRF-Token": "" })).status,
    403,
  );
  assert.equal(
    (await post("/api/plans/build", {}, { Origin: "https://evil.example" }))
      .status,
    403,
  );
  assert.equal(
    (await post("/api/plans/build", { text: "x".repeat(50000) })).status,
    400,
  );
  assert.equal((await post("/api/intake", null)).status, 400);
  const result = await post("/api/plans/build", {});
  assert.equal(result.status, 200);
  const plan = (await (await fetch(base + "/api/state", { headers })).json())
    .plans[0];
  assert.equal(plan.metrics.allocated, 80);
  for (const path of [
    "/.env",
    "/server.mjs",
    "/.data/rescueroute.json",
    "/lib/auth.mjs",
  ])
    assert.equal((await fetch(base + path, { headers })).status, 404);
  const donorHeaders = await login(base, "donor");
  assert.equal(
    (
      await fetch(base + "/api/plans/build", {
        method: "DELETE",
        headers,
        body: "{}",
      })
    ).status,
    405,
  );
  assert.equal(
    (
      await fetch(base + "/api/plans/build", {
        method: "POST",
        headers: donorHeaders,
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/export", { headers: donorHeaders })).status,
    403,
  );
  assert.equal(
    (await post("/api/intake", { message: "10 meals. Collect by 17:00." }))
      .status,
    200,
  );
  assert.equal(
    (await post("/api/intake", { message: "10 meals." })).status,
    429,
  );
  assert.equal((await post("/api/logout", {})).status, 200);
  assert.equal((await fetch(base + "/api/state", { headers })).status, 401);
});

test("password resets invalidate existing authenticated sessions", async (t) => {
  const { base } = await application(t);
  const admin = await login(base, "admin"),
    donor = await login(base, "donor");
  const state = await (
    await fetch(base + "/api/state", { headers: admin })
  ).json();
  const account = state.users.find(
    (u) => u.email === "donor@demo.rescueroute.test",
  );
  const response = await fetch(base + "/api/users", {
    method: "POST",
    headers: admin,
    body: JSON.stringify({
      ...account,
      revision: state.revision,
      password: "Replacement!2026",
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(
    (await fetch(base + "/api/state", { headers: donor })).status,
    401,
  );
  assert.equal(
    (await fetch(base + "/api/state", { headers: admin })).status,
    200,
  );
});

test("reset requires administrator credentials and invalidates every session", async (t) => {
  const { base } = await application(t);
  const admin = await login(base, "admin"),
    donor = await login(base, "donor");
  const post = (headers, data) =>
    fetch(base + "/api/reset", {
      method: "POST",
      headers,
      body: JSON.stringify(data),
    });
  assert.equal(
    (await post(donor, { confirm: "RESET DEMO", password: DEMO_PASSWORD }))
      .status,
    403,
  );
  assert.equal(
    (await post(admin, { confirm: "RESET DEMO", password: "wrong" })).status,
    400,
  );
  assert.equal(
    (await post(admin, { confirm: "RESET DEMO", password: DEMO_PASSWORD }))
      .status,
    200,
  );
  assert.equal(
    (await fetch(base + "/api/state", { headers: admin })).status,
    401,
  );
  assert.equal(
    (await fetch(base + "/api/state", { headers: donor })).status,
    401,
  );
});
test("persistent database survives restart, serialises writes and rolls back failed transactions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "rescueroute-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new Database({ directory, initial: seedDatabase() });
  await db.initialise();
  await Promise.all(
    Array.from({ length: 5 }, () =>
      db.transaction((s) => {
        s.settings.networkName += "!";
      }),
    ),
  );
  const revision = db.read().revision;
  await assert.rejects(
    db.transaction((s) => {
      s.settings.city = "Lost update";
      throw new Error("Rollback");
    }),
  );
  assert.equal(db.read().revision, revision);
  const restored = new Database({ directory });
  assert.ok(restored.read().settings.networkName.endsWith("!!!!!"));
  assert.equal(restored.read().settings.city, "Harbor City");
  assert.equal(restored.read().revision, revision);
});
