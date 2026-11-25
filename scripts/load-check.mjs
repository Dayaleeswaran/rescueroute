import { performance } from "node:perf_hooks";
import { createApp } from "../server.mjs";
import { DEMO_PASSWORD } from "../lib/auth.mjs";

// Reproducible loopback exercise. No external service or real API key is used.
const server = createApp({ aiKey: "" });
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "admin@demo.rescueroute.test",
      password: DEMO_PASSWORD,
    }),
  });
  if (!login.ok) throw Error("Load-check sign-in failed.");
  const session = await login.json();
  const headers = {
    Cookie: login.headers.get("set-cookie").split(";")[0],
    "X-CSRF-Token": session.csrf,
    "Content-Type": "application/json",
  };
  const results = [];
  for (const route of ["/api/state", "/api/plans/preview"]) {
    const times = [];
    const started = performance.now();
    await Promise.all(
      Array.from({ length: 5 }, async () => {
        for (let i = 0; i < 10; i++) {
          const start = performance.now();
          const response = await fetch(base + route, {
            headers,
            ...(route.endsWith("preview")
              ? {
                  method: "POST",
                  body: JSON.stringify({ revision: 1, volunteerId: "v2" }),
                }
              : {}),
          });
          const data = await response.json();
          if (
            !response.ok ||
            (route.endsWith("preview") && data.difference !== -20)
          )
            throw Error("A bounded load-check request failed validation.");
          times.push(performance.now() - start);
        }
      }),
    );
    times.sort((a, b) => a - b);
    results.push({
      route,
      requests: times.length,
      concurrency: 5,
      p50Ms: +times[Math.ceil(times.length * 0.5) - 1].toFixed(2),
      p95Ms: +times[Math.ceil(times.length * 0.95) - 1].toFixed(2),
      totalMs: +(performance.now() - started).toFixed(2),
    });
  }
  const state = await (await fetch(base + "/api/state", { headers })).json();
  if (state.revision !== 1 || state.plans.length || state.totals.reserved)
    throw Error("Read-only load exercise changed network state.");
  console.log(
    JSON.stringify(
      {
        runtime: process.version,
        platform: process.platform,
        results,
        stateUnchanged: true,
        scope:
          "Local loopback HTTP, one demo session, five concurrent workers. Not a cloud, multi-user, browser, or Gemini latency benchmark.",
      },
      null,
      2,
    ),
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
