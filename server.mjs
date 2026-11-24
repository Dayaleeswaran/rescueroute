import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Database, seedDatabase } from "./lib/database.mjs";
import { Sessions, publicUser, verifyPassword } from "./lib/auth.mjs";
import * as ops from "./lib/operations.mjs";
import { extractOffer } from "./lib/intake.mjs";
import { InputError } from "./lib/validation.mjs";

const assets = new Map([
  ["/", ["public/index.html", "text/html"]],
  ["/app.js", ["public/app.js", "text/javascript"]],
  ["/styles.css", ["public/styles.css", "text/css"]],
  ["/platform.css", ["public/platform.css", "text/css"]],
  ["/icon.svg", ["public/icon.svg", "image/svg+xml"]],
]);
async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json"))
    throw new InputError("Content-Type must be application/json.");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 48000) throw new InputError("Request is too large.");
    chunks.push(chunk);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InputError("Invalid JSON.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new InputError("A JSON object is required.");
  return result;
}
export function createApp({
  aiKey = process.env.OPENAI_API_KEY,
  aiModel = process.env.OPENAI_MODEL,
  fetcher = fetch,
  database = new Database(),
} = {}) {
  const sessions = new Sessions();
  const loginAttempts = new Map();
  let aiBusy = false,
    lastIntake = 0;
  const server = createServer(async (req, res) => {
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
      const changing = ["POST", "PATCH", "DELETE"].includes(req.method);
      if (
        changing &&
        req.method !== "POST" &&
        !(req.method === "DELETE" && path.startsWith("/api/entities/"))
      )
        return json(405, { error: "Method not allowed." });
      if (
        changing &&
        ((req.headers.origin &&
          req.headers.origin !== `http://${req.headers.host}`) ||
          req.headers["sec-fetch-site"] === "cross-site")
      )
        return json(403, { error: "Cross-origin requests are not allowed." });
      if (req.method === "GET" && assets.has(path)) {
        const [file, type] = assets.get(path);
        const data = await readFile(new URL(file, import.meta.url));
        res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
        return res.end(data);
      }
      if (req.method === "POST" && path === "/api/login") {
        const data = await body(req);
        const address = req.socket.remoteAddress;
        const attempts = loginAttempts.get(address) || {
          count: 0,
          until: Date.now() + 600000,
        };
        if (Date.now() > attempts.until) {
          attempts.count = 0;
          attempts.until = Date.now() + 600000;
        }
        if (attempts.count >= 15)
          return json(429, {
            error: "Too many sign-in attempts. Try again in ten minutes.",
          });
        attempts.count++;
        loginAttempts.set(address, attempts);
        const db = database.read();
        const user = db.users.find(
          (u) =>
            u.email === String(data.email).trim().toLowerCase() && u.active,
        );
        const valid = verifyPassword(
          data.password,
          user?.passwordHash || db.users[0].passwordHash,
        );
        if (!user || !valid)
          return json(401, { error: "Email or password is incorrect." });
        loginAttempts.delete(address);
        const s = sessions.create(
          user.id,
          user.authVersion || 0,
          db.instanceId,
        );
        res.setHeader(
          "Set-Cookie",
          `rr_session=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`,
        );
        return json(200, {
          user: publicUser(user),
          csrf: s.csrf,
          intake: aiKey ? "live" : "local",
        });
      }
      const session = sessions.get(req.headers.cookie);
      if (!session) return json(401, { error: "Sign in to continue." });
      const user = ops.actor(database.read(), session.userId);
      if (
        (user.authVersion || 0) !== session.authVersion ||
        database.read().instanceId !== session.instanceId
      ) {
        sessions.delete(session.token);
        return json(401, {
          error: "Your account or demo changed. Sign in again.",
        });
      }
      const mutate = (change) =>
        database.transaction((db) => {
          const current = ops.actor(db, session.userId);
          if (
            (current.authVersion || 0) !== session.authVersion ||
            db.instanceId !== session.instanceId
          )
            throw new ops.AppError(
              401,
              "Your account or demo changed. Sign in again.",
            );
          return change(db);
        });
      if (req.method === "GET" && path === "/api/session")
        return json(200, {
          user: publicUser(user),
          csrf: session.csrf,
          intake: aiKey ? "live" : "local",
        });
      if (req.method === "GET" && path === "/api/state")
        return json(200, ops.stateView(database.read(), user));
      if (req.method === "GET" && path === "/api/export") {
        const db = database.read();
        ops.manager(user);
        return json(200, {
          product: "RescueRoute",
          demo: true,
          exportedAt: new Date().toISOString(),
          assumptions:
            "Fictional city grid; 24 km/h; 4 minutes per stop; donor-declared handling; simulated handoffs.",
          ...ops.stateView(db, user),
        });
      }
      if (!changing) return json(404, { error: "Not found." });
      if (req.headers["x-csrf-token"] !== session.csrf)
        return json(403, {
          error: "Invalid session token. Reload and try again.",
        });
      const data = await body(req);
      if (path === "/api/logout") {
        sessions.delete(session.token);
        res.setHeader(
          "Set-Cookie",
          "rr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        );
        return json(200, { ok: true });
      }
      if (path === "/api/intake") {
        if (!ops.isManager(user) && user.role !== "donor")
          return json(403, {
            error: "Only donors and coordinators can extract offers.",
          });
        if (aiBusy || Date.now() - lastIntake < 1200)
          return json(429, {
            error: "Please wait a moment before analysing another message.",
          });
        aiBusy = true;
        lastIntake = Date.now();
        try {
          return json(
            200,
            await extractOffer(data.message, {
              key: aiKey,
              model: aiModel,
              fetcher,
            }),
          );
        } finally {
          aiBusy = false;
        }
      }
      if (path === "/api/reset") {
        ops.admin(user);
        if (
          data.confirm !== "RESET DEMO" ||
          !verifyPassword(
            data.password,
            database.read().users.find((u) => u.id === user.id).passwordHash,
          )
        )
          return json(400, {
            error: "Enter RESET DEMO and your current administrator password.",
          });
        await mutate((db) => {
          const fresh = seedDatabase();
          for (const key of Object.keys(db)) delete db[key];
          Object.assign(db, fresh);
        });
        sessions.clear();
        return json(200, { ok: true });
      }
      let result;
      if (path.startsWith("/api/entities/")) {
        const kind = path.slice("/api/entities/".length);
        result = await mutate((db) =>
          req.method === "DELETE"
            ? ops.deleteEntity(db, user.id, kind, data)
            : ops.saveEntity(db, user.id, kind, data),
        );
      } else if (path.startsWith("/api/withdraw/"))
        result = await mutate((db) =>
          ops.withdrawEntity(
            db,
            user.id,
            path.slice("/api/withdraw/".length),
            data,
          ),
        );
      else if (path.startsWith("/api/review/"))
        result = await mutate((db) =>
          ops.reviewEntity(
            db,
            user.id,
            path.slice("/api/review/".length),
            data,
          ),
        );
      else if (path === "/api/plans/build")
        result = await mutate((db) => ops.buildDraft(db, user.id));
      else if (path === "/api/plans/confirm")
        result = await mutate((db) => ops.confirmDraft(db, user.id, data));
      else if (path === "/api/trips/transition")
        result = await mutate((db) => ops.transitionTrip(db, user.id, data));
      else if (path === "/api/volunteers/availability")
        result = await mutate((db) => ops.cancelVolunteer(db, user.id, data));
      else if (path === "/api/plans/release")
        result = await mutate((db) => ops.releaseUnstarted(db, user.id, data));
      else if (path === "/api/users")
        result = await mutate((db) => ops.saveUser(db, user.id, data));
      else if (path === "/api/settings")
        result = await mutate((db) => ops.saveSettings(db, user.id, data));
      else return json(404, { error: "Not found." });
      json(200, { ok: true, result });
    } catch (error) {
      const status = error.status || (error instanceof InputError ? 400 : 500);
      if (status >= 500)
        console.error("Request failed:", error.name, error.message);
      json(status, {
        error:
          status < 500
            ? error.message
            : "Unable to complete the request. No changes were committed. Try again or inspect the server console.",
      });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const database = new Database({
    directory: resolve(process.env.DATA_DIR || ".data"),
  });
  await database.initialise();
  const port = Number(process.env.PORT || 3000);
  createApp({ database }).listen(port, "127.0.0.1", () =>
    console.log(
      `RescueRoute is running at http://localhost:${port}\nDemo sign-in: admin@demo.rescueroute.test · See README for demo password.`,
    ),
  );
}
