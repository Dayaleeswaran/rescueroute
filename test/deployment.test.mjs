import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createApp } from "../server.mjs";
import { DEMO_PASSWORD } from "../lib/auth.mjs";
import { deploymentConfig } from "../lib/deployment.mjs";
import { DemoWorkspaces } from "../lib/demo-workspaces.mjs";

const origin = "https://rescueroute.example";
test("cloud mode requires an explicit HTTPS origin", () => {
  for (const value of [
    "",
    "http://example.test",
    "https://example.test/path",
    "https://a:b@example.test",
    "https://example.test?x=1",
  ])
    assert.throws(() =>
      deploymentConfig({ publicDemo: true, publicOrigin: value }),
    );
  assert.equal(
    deploymentConfig({ publicDemo: true, publicOrigin: origin }).hostname,
    "rescueroute.example",
  );
});

test("public hosting isolates visitors, cookies, resets, reservations and tracking", async (t) => {
  const server = createApp({
    publicDemo: true,
    publicOrigin: origin,
    aiKey: "must-not-be-used",
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  // Simulate Render's HTTPS edge forwarding an HTTP request to the Node server.
  // fetch intentionally ignores a custom Host, so use the raw HTTP test client.
  const request = (path, client = {}, data, extra = {}) =>
    new Promise((resolve, reject) => {
      const req = httpRequest(
        base + path,
        {
          method: data === undefined ? "GET" : "POST",
          headers: {
            Host: "rescueroute.example",
            Origin: origin,
            "Content-Type": "application/json",
            ...client,
            ...extra,
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              json: async () =>
                JSON.parse(Buffer.concat(chunks).toString("utf8")),
              headers: { getSetCookie: () => res.headers["set-cookie"] || [] },
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(data === undefined ? undefined : JSON.stringify(data));
    });
  const login = async (client = {}, account = "admin") => {
    const r = await request("/api/login", client, {
      email: `${account}@demo.rescueroute.test`,
      password: DEMO_PASSWORD,
    });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.intake, "local");
    assert.equal(data.deployment.isolated, true);
    const cookies = r.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(
      cookies.every((c) => c.includes("Secure") && c.includes("HttpOnly")),
    );
    return {
      Cookie: cookies.map((c) => c.split(";")[0]).join("; "),
      "X-CSRF-Token": data.csrf,
    };
  };
  assert.equal(
    (await request("/health", {}, undefined, { Host: "internal-healthcheck" }))
      .status,
    200,
  );
  assert.equal(
    (await request("/", {}, undefined, { Host: "attacker.example" })).status,
    403,
  );
  assert.equal(
    (
      await request(
        "/api/login",
        {},
        { email: "x", password: "x" },
        { Origin: "https://attacker.example" },
      )
    ).status,
    403,
  );
  const a = await login(),
    b = await login();
  assert.notEqual(a.Cookie, b.Cookie);
  let aState = await (await request("/api/state", a)).json();
  const draft = await (await request("/api/plans/build", a, {})).json();
  aState = await (await request("/api/state", a)).json();
  assert.equal(
    (
      await request("/api/plans/confirm", a, {
        id: draft.result,
        revision: aState.revision,
      })
    ).status,
    200,
  );
  assert.equal(
    (await (await request("/api/state", a)).json()).totals.reserved,
    80,
  );
  assert.equal(
    (await (await request("/api/state", b)).json()).totals.reserved,
    0,
  );
  assert.equal(
    (
      await request("/api/state", {
        Cookie: `${a.Cookie.split("; ")[0]}; ${b.Cookie.split("; ")[1]}`,
      })
    ).status,
    401,
  );
  const volunteer = await login(a, "volunteer");
  assert.equal(
    (
      await request("/api/tracking/gps", volunteer, {
        latitude: 6.92,
        longitude: 79.91,
        accuracy: 10,
      })
    ).status,
    200,
  );
  const adminA = await login(volunteer);
  assert.equal(
    (await (await request("/api/state", adminA)).json()).mapData.entities.find(
      (e) => e.id === "v1",
    ).fix.mode,
    "gps",
  );
  assert.equal(
    (await (await request("/api/state", b)).json()).mapData.entities.find(
      (e) => e.id === "v1",
    ).fix,
    null,
  );
  assert.equal(
    (
      await request("/api/reset", adminA, {
        confirm: "RESET DEMO",
        password: DEMO_PASSWORD,
      })
    ).status,
    200,
  );
  assert.equal((await request("/api/state", b)).status, 200);
  assert.equal((await request("/api/state", adminA)).status, 401);
});

test("temporary demo workspaces have bounded capacity and expire cleanly", (t) => {
  let now = 0;
  const workspaces = new DemoWorkspaces({ max: 1, ttl: 1000, now: () => now });
  t.after(() => workspaces.close());
  const first = workspaces.get("", true);
  assert.equal(workspaces.get(`rr_workspace=${first.id}`), first);
  assert.throws(() => workspaces.get("", true), /capacity/);
  now = 1001;
  assert.equal(workspaces.get(`rr_workspace=${first.id}`), null);
  assert.notEqual(workspaces.get("", true).id, first.id);
});
