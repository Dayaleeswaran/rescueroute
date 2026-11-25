import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { Database, seedDatabase } from "./lib/database.mjs";
import { Sessions, publicUser, verifyPassword } from "./lib/auth.mjs";
import * as ops from "./lib/operations.mjs";
import { createIntakeService } from "./lib/intake.mjs";
import { InputError } from "./lib/validation.mjs";
import { LiveNetwork } from "./lib/live-network.mjs";
import { deploymentConfig, allowedHost } from "./lib/deployment.mjs";
import { DemoWorkspaces } from "./lib/demo-workspaces.mjs";
import { previewPlan } from "./lib/plan-preview.mjs";

const assets = new Map([
  ["/", ["public/index.html", "text/html"]],
  ["/app.js", ["public/app.js", "text/javascript"]],
  ["/rescue-live.js", ["public/rescue-live.js", "text/javascript"]],
  ["/rescue-guide.js", ["public/rescue-guide.js", "text/javascript"]],
  ["/styles.css", ["public/styles.css", "text/css"]],
  ["/platform.css", ["public/platform.css", "text/css"]],
  ["/icon.svg", ["public/icon.svg", "image/svg+xml"]],
  ["/network-map.js", ["public/network-map.js", "text/javascript"]],
  ["/network-map.css", ["public/network-map.css", "text/css"]],
  [
    "/vendor/leaflet/leaflet.js",
    ["public/vendor/leaflet/leaflet.js", "text/javascript"],
  ],
  [
    "/vendor/leaflet/leaflet.css",
    ["public/vendor/leaflet/leaflet.css", "text/css"],
  ],
  [
    "/vendor/leaflet/leaflet.js.map",
    ["public/vendor/leaflet/leaflet.js.map", "application/json"],
  ],
]);
for (const name of [
  "layers-2x.png",
  "layers.png",
  "marker-icon-2x.png",
  "marker-icon.png",
  "marker-shadow.png",
])
  assets.set(`/vendor/leaflet/images/${name}`, [
    `public/vendor/leaflet/images/${name}`,
    "image/png",
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
  aiKey = process.env.GEMINI_API_KEY,
  aiModel = process.env.GEMINI_MODEL || "gemini-3.8-flash",
  aiTimeoutMs = Number(process.env.GEMINI_TIMEOUT_MS || 8000),
  publicAiEnabled = process.env.PUBLIC_AI_ENABLED === "true",
  fetcher = fetch,
  database = new Database(),
  publicDemo = false,
  publicOrigin = "",
} = {}) {
  const config = deploymentConfig({ publicDemo, publicOrigin });
  const sharedDatabase = database;
  const sessions = new Sessions();
  const sharedLive = new LiveNetwork(sharedDatabase);
  const workspaces = publicDemo ? new DemoWorkspaces() : null;
  const sharedIntake = { busy: false, last: 0 };
  const deployment = {
    mode: publicDemo ? "public-demo" : "local",
    isolated: publicDemo,
    temporary: publicDemo,
  };
  const aiEnabled = !!aiKey && (!publicDemo || publicAiEnabled);
  const intakeService = createIntakeService({
    key: aiEnabled ? aiKey : "",
    model: aiModel,
    fetcher,
    timeoutMs: aiTimeoutMs,
    maxRequestsPerHour: publicDemo ? 60 : Infinity,
    localOnlyReason:
      publicDemo && !publicAiEnabled ? "disabled_public" : undefined,
  });
  const loginAttempts = new Map();
  const server = createServer(async (req, res) => {
    if (config.publicDemo)
      res.setHeader("Strict-Transport-Security", "max-age=31536000");
    res.setHeader(
      "Permissions-Policy",
      "geolocation=(self), camera=(), microphone=(), payment=(), usb=()",
    );
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const json = (status, data) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
      });
      res.end(JSON.stringify(data));
    };
    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/health")
        return json(200, {
          status: "ok",
          service: "RescueRoute",
          mode: deployment.mode,
        });
      if (!allowedHost(req.headers.host, config))
        return json(403, {
          error: "This hostname is not configured for RescueRoute.",
        });
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
          req.headers.origin !==
            (config.origin || `http://${req.headers.host}`)) ||
          req.headers["sec-fetch-site"] === "cross-site")
      )
        return json(403, { error: "Cross-origin requests are not allowed." });
      if (req.method === "GET" && assets.has(path)) {
        const [file, type] = assets.get(path);
        const data = await readFile(new URL(file, import.meta.url));
        const etag = `"${createHash("sha256").update(data).digest("base64url")}"`;
        res.setHeader("ETag", etag);
        res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
        if (
          req.headers["if-none-match"]
            ?.split(",")
            .some(
              (value) =>
                value.trim().replace(/^W\//, "") === etag ||
                value.trim() === "*",
            )
        ) {
          res.writeHead(304);
          return res.end();
        }
        res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
        return res.end(data);
      }
      if (req.method === "GET" && path === "/api/config")
        return json(200, { deployment });
      let workspace = workspaces?.get(req.headers.cookie, false);
      if (
        publicDemo &&
        !workspace &&
        !(req.method === "POST" && path === "/api/login")
      )
        return json(401, {
          error:
            "Your temporary demo workspace expired. Sign in to start a fresh one.",
        });
      const database =
          workspace?.database ||
          (publicDemo ? workspaces.template : sharedDatabase),
        live = workspace?.live || sharedLive;
      const intake = workspace?.intake || sharedIntake;
      if (req.method === "POST" && path === "/api/login") {
        const data = await body(req);
        const address = req.socket.remoteAddress;
        if (loginAttempts.size >= 1024) {
          for (const [key, value] of loginAttempts)
            if (Date.now() > value.until) loginAttempts.delete(key);
          if (loginAttempts.size >= 1024)
            loginAttempts.delete(loginAttempts.keys().next().value);
        }
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
        if (publicDemo && !workspace) workspace = workspaces.get("", true);
        const s = sessions.create(
          user.id,
          user.authVersion || 0,
          workspace?.database.read().instanceId || db.instanceId,
        );
        res.setHeader("Set-Cookie", [
          ...(workspace
            ? [
                `rr_workspace=${workspace.id}; HttpOnly; SameSite=Strict; Path=/; Secure`,
              ]
            : []),
          `rr_session=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${config.secureCookies ? "; Secure" : ""}`,
        ]);
        return json(200, {
          user: publicUser(user),
          csrf: s.csrf,
          intake: aiEnabled ? "live" : "local",
          ai: { provider: "gemini", configured: aiEnabled, model: aiModel },
          deployment,
        });
      }
      const session = sessions.get(req.headers.cookie);
      if (!session) return json(401, { error: "Sign in to continue." });
      const user = ops.actor(database.read(), session.userId);
      if (
        (user.authVersion || 0) !== session.authVersion ||
        database.read().instanceId !== session.instanceId
      ) {
        // A cookie from a different isolated workspace must not revoke that
        // workspace's otherwise valid session.
        if (database.read().instanceId === session.instanceId)
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
          intake: aiEnabled ? "live" : "local",
          ai: { provider: "gemini", configured: aiEnabled, model: aiModel },
          deployment,
        });
      if (req.method === "GET" && path === "/api/events")
        return live.connect(req, res, () => {
          const currentSession = sessions.get(req.headers.cookie),
            db = database.read(),
            u = db.users.find((u) => u.id === user.id);
          return (
            !!currentSession &&
            !!u?.active &&
            (u.authVersion || 0) === session.authVersion &&
            db.instanceId === session.instanceId
          );
        });
      if (req.method === "GET" && path === "/api/state") {
        const db = database.read(),
          view = ops.stateView(db, user);
        view.deployment = deployment;
        view.mapData = live.view(db, user, view);
        return json(200, view);
      }
      if (req.method === "GET" && path === "/api/export") {
        const db = database.read();
        ops.manager(user);
        return json(200, {
          product: "RescueRoute",
          demo: true,
          deployment,
          exportedAt: new Date().toISOString(),
          assumptions:
            "Geographic straight-line planning distances; 24 km/h; 4 minutes per stop; illustrative demo placements unless entered manually; donor-declared handling; simulated handoffs.",
          ...ops.stateView(db, user),
        });
      }
      if (!changing) return json(404, { error: "Not found." });
      if (req.headers["x-csrf-token"] !== session.csrf)
        return json(403, {
          error: "Invalid session token. Reload and try again.",
        });
      const data = await body(req);
      const latest = database.read(),
        currentUser = ops.actor(latest, user.id);
      if (
        !sessions.get(req.headers.cookie) ||
        (currentUser.authVersion || 0) !== session.authVersion ||
        latest.instanceId !== session.instanceId
      )
        throw new ops.AppError(401, "Your session changed. Sign in again.");
      if (path === "/api/tracking/gps") {
        live.gps(user, data);
        return json(200, { ok: true });
      }
      if (path === "/api/tracking/demo") {
        live.demo(user, data);
        return json(200, { ok: true });
      }
      if (path === "/api/tracking/stop") {
        live.stop(user, data.id);
        return json(200, { ok: true });
      }
      if (path === "/api/logout") {
        live.logout(user);
        sessions.delete(session.token);
        res.setHeader(
          "Set-Cookie",
          `rr_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${config.secureCookies ? "; Secure" : ""}`,
        );
        return json(200, { ok: true });
      }
      if (path === "/api/intake") {
        if (!ops.isManager(user) && user.role !== "donor")
          return json(403, {
            error: "Only donors and coordinators can extract offers.",
          });
        if (intake.busy || Date.now() - intake.last < 1200)
          return json(429, {
            error: "Please wait a moment before analysing another message.",
          });
        intake.busy = true;
        intake.last = Date.now();
        try {
          return json(
            200,
            await intakeService.extract(data.message, {
              now: database.read().settings.now,
              donors: ops
                .stateView(database.read(), user)
                .donors.map((d) => ({ name: d.name })),
            }),
          );
        } finally {
          intake.busy = false;
        }
      }
      if (path === "/api/plans/preview")
        return json(200, previewPlan(database.read(), user.id, data));
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
        const oldInstanceId = database.read().instanceId;
        await mutate((db) => {
          const fresh = seedDatabase();
          for (const key of Object.keys(db)) delete db[key];
          Object.assign(db, fresh);
        });
        sessions.removeInstance(oldInstanceId);
        live.fixes.clear();
        live.broadcast("network", {});
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
  server.on("close", () => {
    sharedLive.close();
    workspaces?.close();
  });
  server.headersTimeout = 10000;
  server.maxHeadersCount = 50;
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const publicDemo = process.env.PUBLIC_DEMO === "true";
  const publicOrigin =
    process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || "";
  deploymentConfig({ publicDemo, publicOrigin });
  const database = new Database({
    directory: publicDemo ? null : resolve(process.env.DATA_DIR || ".data"),
  });
  await database.initialise();
  const port = Number(process.env.PORT || 3000);
  createApp({ database, publicDemo, publicOrigin }).listen(
    port,
    publicDemo ? "0.0.0.0" : "127.0.0.1",
    () =>
      console.log(
        `RescueRoute is running at ${publicDemo ? publicOrigin : `http://localhost:${port}`}\nMode: ${publicDemo ? "isolated public demonstration" : "local persistent workspace"}\nDemo sign-in: admin@demo.rescueroute.test · See README for demo password.`,
      ),
  );
}
