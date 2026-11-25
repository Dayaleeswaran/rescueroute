import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createApp } from "../server.mjs";
import { verifyDeployment } from "../scripts/verify-deployment.mjs";

test("deployment verifier exercises real public-demo HTTP with isolated workspaces", async (t) => {
  const origin = "https://demo.rescueroute.test";
  const server = createApp({
    aiKey: "",
    publicDemo: true,
    publicOrigin: origin,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const port = server.address().port;
  const result = await verifyDeployment(
    origin,
    (url, options) =>
      new Promise((resolve, reject) => {
        // Model an HTTPS edge forwarding to Node; fetch itself ignores custom Host.
        const req = httpRequest(
          `http://127.0.0.1:${port}${new URL(url).pathname}`,
          {
            method: options.method || "GET",
            headers: { ...options.headers, Host: "demo.rescueroute.test" },
            signal: options.signal,
          },
          (response) => {
            const chunks = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
              const headers = new Headers();
              for (const [key, value] of Object.entries(response.headers))
                for (const item of Array.isArray(value) ? value : [value])
                  if (item !== undefined) headers.append(key, item);
              resolve(
                new Response(Buffer.concat(chunks), {
                  status: response.statusCode,
                  headers,
                }),
              );
            });
          },
        );
        req.on("error", reject);
        req.end(options.body);
      }),
  );
  assert.equal(result.checksPassed, true);
  assert.ok(result.checks.includes("visitor isolation"));
});

test("deployment verifier rejects non-HTTPS origins before issuing requests", async () => {
  await assert.rejects(
    verifyDeployment("http://example.test", () => {
      throw Error("Unexpected request.");
    }),
    /exact HTTPS origin/,
  );
});
