import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server.mjs";

test("HTTP boundary validates input, protects origin, and does not expose files", async (t) => {
  const server = createApp({ aiKey: "" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, headers = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(
    home.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  const s = await (await fetch(base + "/api/scenario")).json();
  const p = await post("/api/plan", s);
  assert.equal(p.status, 200);
  assert.equal((await p.json()).metrics.allocated, 80);
  assert.equal((await post("/api/plan", {})).status, 400);
  assert.equal(
    (await post("/api/plan", s, { Origin: "https://attacker.example" })).status,
    403,
  );
  assert.equal((await fetch(base + "/.env")).status, 404);
  assert.equal((await fetch(base + "/server.mjs")).status, 404);
  assert.equal(
    (await post("/api/plan", { text: "x".repeat(50000) })).status,
    400,
  );
  const intake = await post("/api/intake", {
    message: "10 meals. Collect by 17:00.",
  });
  assert.equal(intake.status, 200);
  assert.equal((await intake.json()).mode, "local");
  assert.equal(
    (await post("/api/intake", { message: "10 meals" })).status,
    429,
  );
});
