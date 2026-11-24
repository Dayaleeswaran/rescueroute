import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createScenario } from "./lib/scenario.mjs";
import { planRescue, auditPlan } from "./lib/planner.mjs";
import { extractOffer } from "./lib/intake.mjs";
import { InputError } from "./lib/validation.mjs";

const assets = new Map([
  ["/", ["public/index.html", "text/html"]],
  ["/app.js", ["public/app.js", "text/javascript"]],
  ["/styles.css", ["public/styles.css", "text/css"]],
  ["/icon.svg", ["public/icon.svg", "image/svg+xml"]],
  ["/lib/planner.mjs", ["lib/planner.mjs", "text/javascript"]],
  ["/lib/validation.mjs", ["lib/validation.mjs", "text/javascript"]],
]);
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new InputError("Content-Type must be application/json.");
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 48000)
      throw new InputError("Request is too large.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new InputError("Invalid JSON.");
  }
}
export function createApp({
  aiKey = process.env.OPENAI_API_KEY,
  aiModel = process.env.OPENAI_MODEL,
  fetcher = fetch,
} = {}) {
  let aiBusy = false,
    lastIntake = 0;
  return createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      if (
        !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(
          req.headers.host || "",
        )
      )
        return json(403, {
          error: "Only local hostnames are accepted by this demo.",
        });
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/api/scenario")
        return json(200, createScenario());
      if (req.method === "GET" && path === "/api/status")
        return json(200, { intake: aiKey ? "live" : "local" });
      if (req.method === "POST") {
        const origin = req.headers.origin;
        if (
          (origin && origin !== `http://${req.headers.host}`) ||
          req.headers["sec-fetch-site"] === "cross-site"
        )
          return json(403, { error: "Cross-origin requests are not allowed." });
        const input = await body(req);
        if (path === "/api/plan") {
          const plan = planRescue(input);
          if (auditPlan(input, plan).length)
            throw new Error("The allocation failed its feasibility check.");
          return json(200, plan);
        }
        if (path === "/api/intake") {
          if (!input || typeof input !== "object" || Array.isArray(input))
            throw new InputError("An intake message is required.");
          if (aiBusy || Date.now() - lastIntake < 1200)
            return json(429, {
              error: "Please wait a moment before analysing another message.",
            });
          aiBusy = true;
          lastIntake = Date.now();
          try {
            return json(
              200,
              await extractOffer(input.message, {
                key: aiKey,
                model: aiModel,
                fetcher,
              }),
            );
          } finally {
            aiBusy = false;
          }
        }
      }
      if (req.method === "GET" && assets.has(path)) {
        const [file, type] = assets.get(path);
        const content = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
        return res.end(content);
      }
      json(404, { error: "Not found." });
    } catch (error) {
      json(error instanceof InputError ? 400 : 502, {
        error:
          error instanceof InputError
            ? error.message
            : "Unable to complete this request. Review the input or server configuration and try again.",
      });
    }
  });
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  createApp().listen(port, "127.0.0.1", () =>
    console.log(`RescueRoute is running at http://localhost:${port}`),
  );
}
