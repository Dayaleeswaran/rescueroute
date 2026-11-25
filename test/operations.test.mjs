import test from "node:test";
import assert from "node:assert/strict";
import { Database, seedDatabase } from "../lib/database.mjs";
import * as ops from "../lib/operations.mjs";

const seed = seedDatabase();
const fixture = () => new Database({ initial: structuredClone(seed) });
const run = (db, fn, user, input = {}) =>
  db.transaction((s) => fn(s, user, { revision: s.revision, ...input }));
async function confirmed(db) {
  const id = await db.transaction((s) => ops.buildDraft(s, "u1"));
  await run(db, ops.confirmDraft, "u1", { id });
  return db.read().plans.find((p) => p.id === id);
}
const errorStatus = (status) => (error) => error.status === status;

test("owners can withdraw unreserved records but cannot withdraw reserved or unrelated ones", async () => {
  const db = fixture();
  await db.transaction((s) =>
    ops.withdrawEntity(s, "u3", "offers", { id: "o1", revision: s.revision }),
  );
  assert.equal(db.read().offers[0].status, "cancelled");
  assert.ok(
    !ops.availableScenario(db.read()).offers.some((o) => o.id === "o1"),
  );
  await assert.rejects(
    db.transaction((s) =>
      ops.withdrawEntity(s, "u3", "offers", { id: "o2", revision: s.revision }),
    ),
    errorStatus(403),
  );
  const other = fixture();
  await confirmed(other);
  await assert.rejects(
    other.transaction((s) =>
      ops.withdrawEntity(s, "u3", "offers", { id: "o1", revision: s.revision }),
    ),
    errorStatus(409),
  );
});

test("confirmed plan reserves 80 meals; rebuilding cannot allocate them again", async () => {
  const db = fixture();
  const p = await confirmed(db);
  assert.equal(p.metrics.allocated, 80);
  const view = ops.stateView(db.read(), db.read().users[0]);
  assert.equal(view.totals.reserved, 80);
  assert.equal(view.totals.delivered, 0);
  const id = await db.transaction((s) => ops.buildDraft(s, "u1"));
  assert.equal(db.read().plans.find((p) => p.id === id).metrics.allocated, 0);
});
test("concurrent confirmations cannot reserve the same stock twice", async () => {
  const db = fixture();
  const id = await db.transaction((s) => ops.buildDraft(s, "u1"));
  const revision = db.read().revision;
  const confirm = () =>
    db.transaction((s) => ops.confirmDraft(s, "u1", { id, revision }));
  const results = await Promise.allSettled([confirm(), confirm()]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    db.read().plans.filter((p) => p.status === "confirmed").length,
    1,
  );
});
test("operational changes stale a draft and stale confirmation is rejected", async () => {
  const db = fixture();
  const id = await db.transaction((s) => ops.buildDraft(s, "u1"));
  await run(db, ops.cancelVolunteer, "u1", { id: "v2", active: false });
  await assert.rejects(
    run(db, ops.confirmDraft, "u1", { id }),
    errorStatus(409),
  );
  assert.equal(db.read().plans[0].status, "draft");
});
test("delivery counts only after authorised recipient receipt", async () => {
  const db = fixture();
  const p = await confirmed(db);
  const t = p.assignments
    .filter((t) => t.volunteerId === "v1")
    .sort((a, b) => a.pickup - b.pickup)[0];
  const payload = { id: t.id, planId: p.id };
  await run(db, ops.transitionTrip, "u8", { ...payload, status: "accepted" });
  await run(db, ops.transitionTrip, "u8", { ...payload, status: "picked_up" });
  assert.equal(
    ops.stateView(db.read(), db.read().users[0]).totals.delivered,
    0,
  );
  await run(db, ops.transitionTrip, "u8", {
    ...payload,
    status: "awaiting_receipt",
  });
  await assert.rejects(
    run(db, ops.transitionTrip, "u8", { ...payload, status: "delivered" }),
    errorStatus(403),
  );
  const recipientId = db
    .read()
    .requests.find((r) => r.id === t.requestId).recipientId;
  const receiver = db
    .read()
    .users.find((u) => u.role === "recipient" && u.entityId === recipientId);
  await run(db, ops.transitionTrip, receiver.id, {
    ...payload,
    status: "delivered",
  });
  assert.equal(
    ops.stateView(db.read(), db.read().users[0]).totals.delivered,
    t.meals,
  );
  await assert.rejects(
    run(db, ops.transitionTrip, receiver.id, {
      ...payload,
      status: "delivered",
    }),
    errorStatus(409),
  );
});
test("driver cannot skip steps, collect out of order, or cancel while carrying", async () => {
  const db = fixture();
  const p = await confirmed(db);
  const [first, second] = p.assignments
    .filter((t) => t.volunteerId === "v1")
    .sort((a, b) => a.pickup - b.pickup);
  await assert.rejects(
    run(db, ops.transitionTrip, "u8", {
      planId: p.id,
      id: first.id,
      status: "picked_up",
    }),
    errorStatus(409),
  );
  await run(db, ops.transitionTrip, "u8", {
    planId: p.id,
    id: second.id,
    status: "accepted",
  });
  await assert.rejects(
    run(db, ops.transitionTrip, "u8", {
      planId: p.id,
      id: second.id,
      status: "picked_up",
    }),
    errorStatus(409),
  );
  await run(db, ops.transitionTrip, "u8", {
    planId: p.id,
    id: first.id,
    status: "accepted",
  });
  await run(db, ops.transitionTrip, "u8", {
    planId: p.id,
    id: first.id,
    status: "picked_up",
  });
  await assert.rejects(
    run(db, ops.cancelVolunteer, "u8", { id: "v1", active: false }),
    errorStatus(409),
  );
});
test("cancellation releases only that driver’s uncollected meals and restoration permits residual planning", async () => {
  const db = fixture();
  await confirmed(db);
  await run(db, ops.cancelVolunteer, "u9", { id: "v2", active: false });
  let view = ops.stateView(db.read(), db.read().users[0]);
  assert.equal(view.totals.reserved, 60);
  assert.equal(
    ops.availableScenario(db.read()).offers.reduce((n, o) => n + o.meals, 0),
    20,
  );
  await run(db, ops.cancelVolunteer, "u9", { id: "v2", active: true });
  const id = await db.transaction((s) => ops.buildDraft(s, "u1"));
  assert.equal(db.read().plans.find((p) => p.id === id).metrics.allocated, 20);
  await run(db, ops.confirmDraft, "u1", { id });
  view = ops.stateView(db.read(), db.read().users[0]);
  assert.equal(view.totals.reserved, 80);
});
test("global release preserves in-transit food and frees every uncollected reservation", async () => {
  const db = fixture();
  const p = await confirmed(db);
  const t = p.assignments[0];
  await run(db, ops.transitionTrip, "u1", {
    planId: p.id,
    id: t.id,
    status: "accepted",
  });
  await run(db, ops.transitionTrip, "u1", {
    planId: p.id,
    id: t.id,
    status: "picked_up",
  });
  await run(db, ops.releaseUnstarted, "u1");
  const current = db.read().plans[0];
  assert.equal(
    current.assignments.find((x) => x.id === t.id).status,
    "picked_up",
  );
  assert.ok(
    current.assignments
      .filter((x) => x.id !== t.id)
      .every((x) => x.status === "cancelled"),
  );
  assert.equal(
    ops.stateView(db.read(), db.read().users[0]).totals.reserved,
    t.meals,
  );
});
test("ownership, managerial permissions and linked history are enforced", async () => {
  const db = fixture();
  await assert.rejects(
    db.transaction((s) => ops.buildDraft(s, "u3")),
    errorStatus(403),
  );
  await assert.rejects(
    db.transaction((s) =>
      ops.saveEntity(s, "u3", "offers", {
        ...s.offers[1],
        revision: s.revision,
      }),
    ),
    errorStatus(403),
  );
  await assert.rejects(
    db.transaction((s) =>
      ops.deleteEntity(s, "u1", "donors", { id: "d1", revision: s.revision }),
    ),
    errorStatus(409),
  );
  assert.equal(
    ops.stateView(
      db.read(),
      db.read().users.find((u) => u.id === "u3"),
    ).offers.length,
    1,
  );
  assert.equal(
    ops.stateView(
      db.read(),
      db.read().users.find((u) => u.id === "u3"),
    ).users.length,
    0,
  );
  assert.equal(
    ops.stateView(
      db.read(),
      db.read().users.find((u) => u.id === "u3"),
    ).audit.length,
    0,
  );
});
test("donor submissions require review and cannot self-approve", async () => {
  const db = fixture();
  const id = await db.transaction((s) =>
    ops.saveEntity(s, "u3", "offers", {
      ...s.offers[0],
      id: undefined,
      revision: s.revision,
      food: "New vegetable boxes",
      approve: true,
    }),
  );
  const row = db.read().offers.find((o) => o.id === id);
  assert.equal(row.status, "pending");
  assert.equal(row.verified, false);
  await assert.rejects(
    db.transaction((s) =>
      ops.reviewEntity(s, "u3", "offers", {
        id,
        status: "approved",
        revision: s.revision,
      }),
    ),
    errorStatus(403),
  );
  await db.transaction((s) =>
    ops.reviewEntity(s, "u2", "offers", {
      id,
      status: "approved",
      revision: s.revision,
    }),
  );
  assert.equal(db.read().offers.find((o) => o.id === id).verified, true);
});
test("reserved records cannot be edited and failed mutations do not change revision", async () => {
  const db = fixture();
  await confirmed(db);
  const before = db.read();
  await assert.rejects(
    db.transaction((s) =>
      ops.saveEntity(s, "u1", "offers", {
        ...s.offers[0],
        meals: 999,
        revision: s.revision,
      }),
    ),
    errorStatus(409),
  );
  assert.deepEqual(db.read(), before);
});
test("administrator accounts are protected; coordinators cannot manage users", async () => {
  const db = fixture();
  await assert.rejects(
    run(db, ops.saveUser, "u2", { name: "Bad" }),
    errorStatus(403),
  );
  await assert.rejects(
    run(db, ops.saveUser, "u1", {
      id: "u1",
      name: "Jamie",
      email: "admin@demo.rescueroute.test",
      active: false,
    }),
  );
  await run(db, ops.saveUser, "u1", {
    name: "New Coordinator",
    email: "new@example.test",
    role: "coordinator",
    active: true,
    password: "StrongDemo!123",
  });
  assert.equal(db.read().users.at(-1).role, "coordinator");
  assert.ok(
    !JSON.stringify(ops.stateView(db.read(), db.read().users[0])).includes(
      "passwordHash",
    ),
  );
});
test("simulation time cannot move backwards or advance through active trips", async () => {
  const db = fixture();
  await assert.rejects(
    run(db, ops.saveSettings, "u1", {
      networkName: "Test",
      city: "Test",
      now: 900,
    }),
  );
  await confirmed(db);
  await assert.rejects(
    run(db, ops.saveSettings, "u1", {
      networkName: "Test",
      city: "Test",
      now: 1000,
    }),
    errorStatus(409),
  );
  for (const [kind, getId] of [
    ["offers", (s) => s.offers[0].id],
    ["requests", (s) => s.requests[0].id],
    ["volunteers", (s) => s.volunteers[0].id],
    ["recipients", (s) => s.recipients[0].id],
  ]) {
    await assert.rejects(
      db.transaction((s) =>
        ops.deleteEntity(s, "u1", kind, { id: getId(s), revision: s.revision }),
      ),
      errorStatus(409),
    );
  }
});
