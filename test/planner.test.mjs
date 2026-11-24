import test from "node:test";
import assert from "node:assert/strict";
import { createScenario } from "../lib/scenario.mjs";
import { planRescue, auditPlan } from "../lib/planner.mjs";

test("baseline produces an independently feasible plan without mutating input", () => {
  const s = createScenario(),
    snapshot = structuredClone(s);
  const plan = planRescue(s);
  assert.deepEqual(s, snapshot);
  assert.deepEqual(auditPlan(s, plan), []);
  assert.equal(plan.metrics.allocated, 80);
  assert.equal(plan.unmet.length, 0);
  assert.equal(plan.unallocated.length, 0);
});
test("cancellation excludes the absent volunteer and leaves chilled meals unallocated", () => {
  const s = createScenario();
  s.volunteers[1].active = false;
  const plan = planRescue(s);
  assert.deepEqual(auditPlan(s, plan), []);
  assert.ok(
    plan.assignments.every((a) => a.volunteerId !== "v2" && a.offerId !== "o3"),
  );
  assert.ok(
    plan.unallocated.some(
      (u) => u.offerId === "o3" && /chilled/.test(u.reason),
    ),
  );
  assert.ok(plan.metrics.allocated < 80);
});
test("zero volunteers yields a clear explanation and zero allocation", () => {
  const s = createScenario();
  s.volunteers.forEach((v) => (v.active = false));
  const p = planRescue(s);
  assert.equal(p.metrics.allocated, 0);
  assert.equal(
    p.unallocated.reduce((n, o) => n + o.meals, 0),
    80,
  );
  assert.ok(p.unallocated.every((o) => /No volunteers/.test(o.reason)));
});
test("expired offers and unverified food never enter the plan", () => {
  const s = createScenario();
  s.now = 1100;
  assert.equal(planRescue(s).metrics.allocated, 0);
  s.now = 960;
  s.offers.forEach((o) => (o.verified = false));
  assert.equal(planRescue(s).metrics.allocated, 0);
});
test("declared allergens are matched case-insensitively", () => {
  const s = createScenario();
  s.offers.forEach((o) => (o.allergens = ["DAIRY"]));
  s.requests.forEach((r) => (r.excludes = ["dairy"]));
  const p = planRescue(s);
  assert.equal(p.metrics.allocated, 0);
  assert.ok(p.unallocated.every((o) => /allergen/.test(o.reason)));
});
test("recipient demand and vehicle capacity limit allocation", () => {
  const s = createScenario();
  s.requests.forEach((r) => (r.meals = 3));
  s.volunteers.forEach((v) => (v.capacity = 2));
  const p = planRescue(s);
  assert.deepEqual(auditPlan(s, p), []);
  assert.ok(p.metrics.allocated <= 6);
  assert.ok(p.assignments.every((a) => a.meals <= 2));
});
test("independent audit catches tampered counts, duplicate trips and infeasible timing", () => {
  const s = createScenario(),
    p = planRescue(s);
  const tooMany = structuredClone(p);
  tooMany.assignments[0].meals = 10000;
  assert.ok(auditPlan(s, tooMany).length);
  const duplicate = structuredClone(p);
  duplicate.assignments.push(duplicate.assignments[0]);
  assert.ok(auditPlan(s, duplicate).length);
  const time = structuredClone(p);
  time.assignments[0].pickup -= 5;
  assert.ok(auditPlan(s, time).length);
});
test("invalid and excessive input is rejected", () => {
  for (const value of [-1, 1.5, NaN, Infinity, "30"]) {
    const s = createScenario();
    s.offers[0].meals = value;
    assert.throws(() => planRescue(s));
  }
  const duplicate = createScenario();
  duplicate.offers.push(duplicate.offers[0]);
  assert.throws(() => planRescue(duplicate));
  const big = createScenario();
  big.volunteers = Array.from({ length: 31 }, (_, i) => ({
    ...big.volunteers[0],
    id: `v${i}`,
  }));
  assert.throws(() => planRescue(big));
});
test("deterministic generated scenarios preserve stock, demand, timing and feasibility", () => {
  let seed = 1829;
  const random = (n) => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed % n;
  };
  for (let iteration = 0; iteration < 160; iteration++) {
    const s = createScenario();
    s.now += random(50);
    s.offers.forEach((o) => {
      o.meals = 1 + random(90);
      o.deadline = Math.max(o.ready, 990 + random(100));
      o.verified = random(5) !== 0;
    });
    s.requests.forEach((r) => {
      r.meals = 1 + random(100);
      r.deadline = 990 + random(110);
    });
    s.volunteers.forEach((v) => {
      v.active = random(4) !== 0;
      v.capacity = 1 + random(70);
    });
    const p = planRescue(s);
    assert.deepEqual(auditPlan(s, p), [], `scenario ${iteration}`);
    assert.equal(
      p.metrics.allocated + p.unallocated.reduce((n, o) => n + o.meals, 0),
      p.metrics.offered,
    );
    assert.equal(
      p.metrics.allocated + p.unmet.reduce((n, r) => n + r.meals, 0),
      p.metrics.requested,
    );
    assert.deepEqual(planRescue(s), p);
  }
});
