import test from "node:test";
import assert from "node:assert/strict";
import { Database, seedDatabase } from "../lib/database.mjs";
import { LiveNetwork } from "../lib/live-network.mjs";
import {
  coordinates,
  demoCoordinates,
  geographicDistance,
} from "../lib/geo.mjs";
import * as ops from "../lib/operations.mjs";
import { createApp } from "../server.mjs";
import { DEMO_PASSWORD } from "../lib/auth.mjs";
import { createScenario } from "../lib/scenario.mjs";
import { planRescue } from "../lib/planner.mjs";

const seed = seedDatabase();

test("manually entered profile coordinates persist and become the planner location", async () => {
  const db = new Database({ initial: structuredClone(seed) });
  await db.transaction((s) =>
    ops.saveEntity(s, "u1", "donors", {
      ...s.donors[0],
      geo: [6.93, 79.91],
      locationLabel: "Coordinator-entered meeting point",
      revision: s.revision,
    }),
  );
  assert.deepEqual(db.read().donors[0].geo, [6.93, 79.91]);
  const scenario = ops.availableScenario(db.read());
  assert.equal(scenario.coordinateSystem, "geo");
  assert.deepEqual(
    scenario.offers.find((o) => o.id === "o1").point,
    [6.93, 79.91],
  );
  await assert.rejects(
    db.transaction((s) =>
      ops.saveEntity(s, "u1", "donors", {
        ...s.donors[0],
        geo: [999, 79.91],
        revision: s.revision,
      }),
    ),
  );
});

test("existing grid plan reservations retain their quantity and convert committed endpoints for residual planning", (t) => {
  const initial = structuredClone(seed),
    snapshot = createScenario(),
    plan = planRescue(snapshot);
  initial.plans = [
    {
      ...plan,
      id: "legacy",
      status: "confirmed",
      snapshot,
      assignments: plan.assignments.map((a) => ({
        ...a,
        status: "assigned",
        toPoint: snapshot.requests.find((r) => r.id === a.requestId).point,
      })),
    },
  ];
  const db = new Database({ initial }),
    live = new LiveNetwork(db);
  t.after(() => live.close());
  const remaining = ops.availableScenario(db.read());
  assert.equal(remaining.offers.length, 0);
  assert.equal(remaining.requests.length, 0);
  const lastMaya = initial.plans[0].assignments
    .filter((a) => a.volunteerId === "v1")
    .sort((a, b) => a.delivery - b.delivery)
    .at(-1);
  assert.deepEqual(
    remaining.volunteers.find((v) => v.id === "v1").point,
    demoCoordinates(lastMaya.toPoint),
  );
  const admin = initial.users[0];
  const map = live.view(db.read(), admin, ops.stateView(db.read(), admin));
  assert.ok(
    map.links.every((link) =>
      link.points.every((p) => p[0] > 6 && p[0] < 8 && p[1] > 79),
    ),
  );
});
const user = (db, id) => db.read().users.find((u) => u.id === id);
const view = (live, db, u) =>
  live.view(db.read(), u, ops.stateView(db.read(), u));
test("geographic projection is labelled separately and distances use great-circle kilometres", () => {
  assert.deepEqual(coordinates({ point: [0, 0] }), demoCoordinates([0, 0]));
  assert.equal(geographicDistance([0, 0], [0, 0]), 0);
  assert.ok(Math.abs(geographicDistance([0, 0], [0, 1]) - 111.195) < 0.01);
  assert.ok(geographicDistance([0, 179.9], [0, -179.9]) < 23);
});
test("GPS requires volunteer ownership, does not change planning revisions, and stays hidden from unrelated recipients", async (t) => {
  const db = new Database({ initial: structuredClone(seed) });
  let now = 100000;
  const live = new LiveNetwork(db, () => now);
  t.after(() => live.close());
  const v = user(db, "u8"),
    admin = user(db, "u1"),
    recipient = user(db, "u6");
  assert.throws(
    () => live.gps(admin, { latitude: 6.9, longitude: 79.9, accuracy: 10 }),
    /Only volunteers/,
  );
  assert.throws(
    () => live.gps(v, { latitude: 999, longitude: 79.9, accuracy: 10 }),
    /valid location/,
  );
  const revision = db.read().revision;
  live.gps(v, { latitude: 6.92, longitude: 79.9, accuracy: 10 });
  assert.equal(db.read().revision, revision);
  assert.equal(
    view(live, db, admin).entities.find((e) => e.id === "v1").fix.mode,
    "gps",
  );
  assert.equal(
    view(live, db, recipient).entities.some((e) => e.id === "v1"),
    false,
  );
  const id = await db.transaction((s) => ops.buildDraft(s, "u1"));
  await db.transaction((s) =>
    ops.confirmDraft(s, "u1", { id, revision: s.revision }),
  );
  assert.equal(
    view(live, db, recipient).entities.find((e) => e.id === "v1").fix.mode,
    "gps",
  );
  assert.throws(
    () => live.demo(admin, { id: "v1", progress: 0.5 }),
    /cannot replace/,
  );
  now += 121000;
  assert.equal(
    view(live, db, admin).entities.find((e) => e.id === "v1").fix.fresh,
    false,
  );
  live.stop(v);
  assert.equal(
    view(live, db, admin).entities.find((e) => e.id === "v1").fix,
    null,
  );
});
test("demo movement is explicit, requires a coordinator and never modifies inventory or delivery status", (t) => {
  const db = new Database({ initial: structuredClone(seed) });
  const live = new LiveNetwork(db);
  t.after(() => live.close());
  const before = db.read();
  assert.throws(
    () => live.demo(user(db, "u8"), { id: "v1", progress: 0.5 }),
    /Coordinator/,
  );
  live.demo(user(db, "u1"), { id: "v1", progress: 0.5 });
  const entity = view(live, db, user(db, "u1")).entities.find(
    (e) => e.id === "v1",
  );
  assert.equal(entity.fix.mode, "demo");
  assert.match(entity.fix.description, /no assigned delivery/);
  assert.deepEqual(db.read(), before);
  live.stop(user(db, "u1"), "v1");
  assert.equal(live.fix("v1"), null);
});
test("expired GPS fixes disappear and revoked owners stop exposing coordinates", (t) => {
  const db = new Database({ initial: structuredClone(seed) });
  let now = 10000;
  const live = new LiveNetwork(db, () => now);
  t.after(() => live.close());
  live.gps(user(db, "u8"), { latitude: 6.92, longitude: 79.9, accuracy: 20 });
  now += 600001;
  assert.equal(live.fix("v1"), null);
  live.gps(user(db, "u8"), { latitude: 6.92, longitude: 79.9, accuracy: 20 });
  live.logout(user(db, "u8"));
  assert.equal(live.fix("v1"), null);
});
test("authenticated event streams carry invalidation events, not private location payloads", async (t) => {
  const server = createApp({ aiKey: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@demo.rescueroute.test",
      password: DEMO_PASSWORD,
    }),
  });
  const session = await login.json();
  const headers = {
    Cookie: login.headers.get("set-cookie").split(";")[0],
    "Content-Type": "application/json",
    "X-CSRF-Token": session.csrf,
  };
  const abort = new AbortController();
  try {
    const response = await fetch(base + "/api/events", {
      headers,
      signal: abort.signal,
    });
    assert.match(response.headers.get("content-type"), /text\/event-stream/);
    const reader = response.body.getReader(),
      decoder = new TextDecoder();
    assert.match(
      decoder.decode((await reader.read()).value),
      /event: connected/,
    );
    const result = await fetch(base + "/api/tracking/demo", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: "v1", progress: 0.3 }),
    });
    assert.equal(result.status, 200);
    const event = decoder.decode((await reader.read()).value);
    assert.match(event, /event: tracking/);
    assert.ok(!event.includes("coordinates"));
    await reader.cancel();
  } finally {
    abort.abort();
  }
});
test("live network enforces connection limits, GPS rate limits, and demo/stop guards", async (t) => {
  const db = new Database({ initial: structuredClone(seed) });
  let now = 10000;
  const live = new LiveNetwork(db, () => now);
  t.after(() => live.close());

  // Destroyed client is removed without throwing.
  const dead = { res: { destroyed: true, writableEnded: false } };
  assert.equal(live.send(dead, "ping"), false);

  // Connection cap at 32 clients.
  const mockRes = () => ({
    destroyed: false,
    writableEnded: false,
    writeHead() {},
    write: () => true,
    on() {},
    end() {},
    destroy() {},
  });
  for (let i = 0; i < 32; i++) live.connect({}, mockRes(), () => true);
  assert.throws(() => live.connect({}, mockRes(), () => true), /Too many live connections/);

  // GPS rate limit (within 2000ms) and unauthorized stop.
  live.gps(user(db, "u8"), { latitude: 6.92, longitude: 79.9, accuracy: 20 });
  assert.throws(
    () => live.gps(user(db, "u8"), { latitude: 6.93, longitude: 79.91, accuracy: 15 }),
    /one every two seconds/,
  );
  assert.throws(() => live.stop(user(db, "u1"), "v1"), /stop your own GPS/);

  // Demo tracking validation and conflict against active GPS fix.
  assert.throws(
    () => live.demo(user(db, "u1"), { id: "v1", progress: 1.5 }),
    /progress fraction/,
  );
  assert.throws(
    () => live.demo(user(db, "u1"), { id: "v1", progress: 0.5 }),
    /Demo movement cannot replace/,
  );
  now += 2500;
  live.stop(user(db, "u8"), "v1");
  assert.equal(live.fix("v1"), null);

  // Demo tracking along an active assigned plan trip.
  const id = await db.transaction((s) => ops.buildDraft(s, "u1"));
  await db.transaction((s) =>
    ops.confirmDraft(s, "u1", { id, revision: s.revision }),
  );
  live.demo(user(db, "u1"), { id: "v1", progress: 0.5 });
  const assignedEntity = view(live, db, user(db, "u1")).entities.find(
    (e) => e.id === "v1",
  );
  assert.equal(assignedEntity.fix.mode, "demo");
  live.stop(user(db, "u1"), "v1");
});
