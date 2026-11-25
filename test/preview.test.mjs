import test from "node:test";
import assert from "node:assert/strict";
import { seedDatabase, Database } from "../lib/database.mjs";
import { previewPlan } from "../lib/plan-preview.mjs";
import { buildDraft, confirmDraft } from "../lib/operations.mjs";

const seed = seedDatabase();
test("disruption preview explains 80 to 60 portions without any mutation", () => {
  const db = structuredClone(seed),
    before = structuredClone(db);
  const result = previewPlan(db, "u1", {
    revision: db.revision,
    volunteerId: "v2",
  });
  assert.equal(result.baseline.metrics.allocated, 80);
  assert.equal(result.alternative.metrics.allocated, 60);
  assert.equal(result.difference, -20);
  assert.match(
    result.alternative.unallocated.find((o) => o.meals === 20).reason,
    /chilled/,
  );
  assert.deepEqual(db, before);
  assert.ok(!JSON.stringify(result).includes("passwordHash"));
});
test("preview rejects participant access, inactive volunteers and stale revisions", () => {
  const db = structuredClone(seed);
  assert.throws(
    () => previewPlan(db, "u3", { revision: db.revision, volunteerId: "v2" }),
    (e) => e.status === 403,
  );
  assert.throws(
    () =>
      previewPlan(db, "u1", { revision: db.revision - 1, volunteerId: "v2" }),
    (e) => e.status === 409,
  );
  assert.throws(
    () =>
      previewPlan(db, "u1", { revision: db.revision, volunteerId: "unknown" }),
    (e) => e.status === 400,
  );
  db.volunteers[1].active = false;
  assert.throws(
    () => previewPlan(db, "u1", { revision: db.revision, volunteerId: "v2" }),
    (e) => e.status === 400,
  );
});
test("preview preserves existing confirmed reservations and cannot allocate their stock", async () => {
  const db = new Database({ initial: structuredClone(seed) });
  const id = await db.transaction((s) => buildDraft(s, "u1"));
  await db.transaction((s) =>
    confirmDraft(s, "u1", { id, revision: s.revision }),
  );
  const before = structuredClone(db.read());
  const result = previewPlan(db.read(), "u1", {
    revision: db.read().revision,
    volunteerId: "v2",
  });
  assert.equal(result.baseline.metrics.allocated, 0);
  assert.equal(result.alternative.metrics.allocated, 0);
  assert.deepEqual(db.read(), before);
});
