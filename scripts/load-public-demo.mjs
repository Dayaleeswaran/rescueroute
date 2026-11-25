import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createDemoClient } from "./verify-deployment.mjs";
import { DEMO_PASSWORD } from "../lib/auth.mjs";

// Fixed small workload on the owner's disposable demo, not a capacity test.
const clients = [];
try {
  const origin = new URL(process.argv[2]);
  assert(
    origin.protocol === "https:" &&
      origin.pathname === "/" &&
      !origin.username &&
      !origin.password &&
      !origin.search &&
      !origin.hash,
    "Supply the exact public HTTPS origin.",
  );
  const health = await fetch(origin + "health", {
    signal: AbortSignal.timeout(12000),
    redirect: "error",
  });
  assert.equal(health.status, 200);
  assert.equal(
    (await health.json()).mode,
    "public-demo",
    "Only disposable public-demo mode is supported.",
  );
  for (let i = 0; i < 5; i++)
    clients.push(await createDemoClient(origin.origin));
  const results = [];
  for (const route of ["/api/state", "/api/plans/preview"]) {
    const times = [],
      started = performance.now();
    await Promise.all(
      clients.map(async (call) => {
        for (let i = 0; i < 10; i++) {
          const start = performance.now();
          const response = await call(
            route,
            route.endsWith("preview")
              ? { revision: 1, volunteerId: "v2" }
              : undefined,
          );
          assert.equal(response.status, 200);
          assert.equal(
            route.endsWith("preview")
              ? response.data.difference
              : response.data.revision,
            route.endsWith("preview") ? -20 : 1,
          );
          times.push(performance.now() - start);
        }
      }),
    );
    times.sort((a, b) => a - b);
    results.push({
      route,
      requests: times.length,
      independentVisitorSessions: clients.length,
      p50Ms: +times[Math.ceil(times.length * 0.5) - 1].toFixed(2),
      p95Ms: +times[Math.ceil(times.length * 0.95) - 1].toFixed(2),
      totalMs: +(performance.now() - started).toFixed(2),
    });
  }
  for (const call of clients) {
    const { data, status } = await call("/api/state");
    assert.equal(status, 200);
    assert.equal(data.revision, 1);
    assert.equal(data.totals.reserved, 0);
    assert.equal(data.plans.length, 0);
  }
  console.log(
    JSON.stringify(
      {
        origin: origin.origin,
        results,
        stateUnchanged: true,
        scope:
          "100 HTTPS requests across five independent visitor workspaces on the owner's public demo. Authentication, startup and cleanup are excluded from latency percentiles. One small warm-service run, not peak capacity or a global latency guarantee. No Gemini, real GPS, browser, or screen-reader measurement.",
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`Public demo exercise failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  for (const call of clients) {
    try {
      const result = await call("/api/reset", {
        confirm: "RESET DEMO",
        password: DEMO_PASSWORD,
      });
      if (result.status !== 200) throw Error("Reset rejected.");
    } catch {
      console.error(
        "A test workspace could not be reset; it remains temporary and expires with the demo's idle policy.",
      );
      process.exitCode = 1;
    }
  }
}
