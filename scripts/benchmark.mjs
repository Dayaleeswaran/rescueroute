import { performance } from "node:perf_hooks";
import { localReasoning } from "../lib/local-intake.mjs";
import { planRescue, auditPlan } from "../lib/planner.mjs";
import { createScenario } from "../lib/scenario.mjs";

const message =
  "Donor: Green Table\nFood: Vegetable boxes\n30 meals. Collect by 17:30.\nHandling: chilled\nAllergens: none";
function measure(fn, samples) {
  for (let i = 0; i < 10; i++) fn();
  const values = [];
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    fn();
    values.push(performance.now() - start);
  }
  values.sort((a, b) => a - b);
  const percentile = (p) =>
    Math.round(
      values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] *
        1000,
    ) / 1000;
  return {
    samples,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    p99Ms: percentile(0.99),
    maxMs: percentile(1),
  };
}
const base = createScenario();
const stress = createScenario();
stress.offers = Array.from({ length: 30 }, (_, i) => ({
  ...base.offers[0],
  id: `o${i}`,
  meals: 20,
  point: [1 + (i % 9), 1 + (i % 8)],
  deadline: 1200,
}));
stress.requests = Array.from({ length: 30 }, (_, i) => ({
  ...base.requests[0],
  id: `r${i}`,
  meals: 20,
  point: [1 + (i % 8), 1 + (i % 9)],
  deadline: 1250,
}));
stress.volunteers = Array.from({ length: 30 }, (_, i) => ({
  ...base.volunteers[0],
  id: `v${i}`,
  capacity: 30,
  until: 1260,
}));
const stressPlan = planRescue(stress);
if (auditPlan(stress, stressPlan).length)
  throw Error("Stress plan failed feasibility validation.");
console.log(
  JSON.stringify(
    {
      runtime: process.version,
      platform: process.platform,
      localIntake: measure(() => localReasoning(message, { now: 960 }), 1000),
      baselinePlanner: measure(() => planRescue(base), 200),
      boundedStressPlanner: {
        ...measure(() => planRescue(stress), 8),
        offers: 30,
        requests: 30,
        volunteers: 30,
        allocated: stressPlan.metrics.allocated,
        feasible: true,
      },
      scope:
        "Local CPU timings on this machine. No real provider calls, cloud/network latency, rendering, or GPS hardware is measured.",
    },
    null,
    2,
  ),
);
