/**
 * @module server
 * HTTP server, static asset delivery, session/CSRF enforcement, and API routing
 * for RescueRoute. Exports {@link createApp} for programmatic and test usage, and
 * boots the standalone server when executed directly.
 */
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

const MAX_BODY_BYTES = 48000;
const LOGIN_WINDOW_MS = 600000;
const MAX_LOGIN_ATTEMPTS = 15;
const MAX_LOGIN_TRACKED_IPS = 1024;
const INTAKE_COOLDOWN_MS = 1200;

const assets = new Map([
  ["/", ["public/index.html", "text/html"]],
  ["/app.js", ["public/app.js", "text/javascript"]],
  ["/rescue-motion.js", ["public/rescue-motion.js", "text/javascript"]],
  ["/motion.css", ["public/motion.css", "text/css"]],
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
]) {
  assets.set(`/vendor/leaflet/images/${name}`, [
    `public/vendor/leaflet/images/${name}`,
    "image/png",
  ]);
}

/**
 * Parses and validates a JSON object request body within a strict byte limit.
 * @param {import("node:http").IncomingMessage} req - Incoming HTTP request.
 * @returns {Promise<object>} Parsed JSON object.
 * @throws {InputError} If Content-Type, size, JSON syntax, or shape is invalid.
 */
async function readJsonBody(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) {
    throw new InputError("Content-Type must be application/json.");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new InputError("Request is too large.");
    chunks.push(chunk);
  }
  let result;
  try {
    result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new InputError("Invalid JSON.");
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new InputError("A JSON object is required.");
  }
  return result;
}

/**
 * Applies standard security and Content-Security-Policy headers to a response.
 * @param {import("node:http").ServerResponse} res - HTTP response object.
 * @param {boolean} isPublicDemo - Whether HSTS should be enabled for public HTTPS.
 */
function applySecurityHeaders(res, isPublicDemo) {
  if (isPublicDemo) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000");
  }
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
}

/**
 * Sends a UTF-8 JSON response with the given HTTP status code.
 * @param {import("node:http").ServerResponse} res - HTTP response object.
 * @param {number} status - HTTP status code.
 * @param {unknown} data - Serializable response payload.
 */
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/**
 * Serves an allowlisted static asset with SHA-256 ETag conditional caching.
 * @param {import("node:http").IncomingMessage} req - Incoming HTTP request.
 * @param {import("node:http").ServerResponse} res - HTTP response object.
 * @param {string} path - Normalized request pathname.
 * @returns {Promise<void>}
 */
async function serveAsset(req, res, path) {
  const [file, type] = assets.get(path);
  const data = await readFile(new URL(file, import.meta.url));
  const etag = `"${createHash("sha256").update(data).digest("base64url")}"`;
  res.setHeader("ETag", etag);
  res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
  const ifNoneMatch = req.headers["if-none-match"];
  if (
    ifNoneMatch
      ?.split(",")
      .some(
        (value) =>
          value.trim().replace(/^W\//, "") === etag || value.trim() === "*",
      )
  ) {
    res.writeHead(304);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": `${type}; charset=utf-8` });
  res.end(data);
}

/**
 * Checks and updates per-IP sign-in rate limiting state.
 * @param {Map<string, { count: number, until: number }>} loginAttempts - Rate-limit tracker.
 * @param {string} address - Client IP address.
 * @returns {boolean} True when the attempt is allowed, false when rate-limited.
 */
function recordLoginAttempt(loginAttempts, address) {
  const now = Date.now();
  if (loginAttempts.size >= MAX_LOGIN_TRACKED_IPS) {
    for (const [key, value] of loginAttempts) {
      if (now > value.until) loginAttempts.delete(key);
    }
    if (loginAttempts.size >= MAX_LOGIN_TRACKED_IPS) {
      loginAttempts.delete(loginAttempts.keys().next().value);
    }
  }
  const attempts = loginAttempts.get(address) || {
    count: 0,
    until: now + LOGIN_WINDOW_MS,
  };
  if (now > attempts.until) {
    attempts.count = 0;
    attempts.until = now + LOGIN_WINDOW_MS;
  }
  if (attempts.count >= MAX_LOGIN_ATTEMPTS) return false;
  attempts.count += 1;
  loginAttempts.set(address, attempts);
  return true;
}

/**
 * Validates that a session matches the active user record and database instance.
 * @param {object} session - Active session object.
 * @param {object} user - Active user record.
 * @param {object} db - Current database snapshot.
 * @returns {boolean} True if session metadata matches the user and instance.
 */
function sessionMatchesDb(session, user, db) {
  return (
    (user.authVersion || 0) === session.authVersion &&
    db.instanceId === session.instanceId
  );
}

/**
 * Resolves and executes an authenticated state-changing API route.
 * @param {object} params - Dispatch context.
 * @param {import("node:http").IncomingMessage} params.req - HTTP request.
 * @param {string} params.path - Request pathname.
 * @param {object} params.user - Authenticated user record.
 * @param {object} params.data - Parsed JSON request body.
 * @param {(change: (db: object) => unknown) => Promise<unknown>} params.mutate - Transaction helper.
 * @returns {Promise<{ found: boolean, result?: unknown }>} Dispatch outcome.
 */
async function dispatchMutation({ req, path, user, data, mutate }) {
  if (path.startsWith("/api/entities/")) {
    const kind = path.slice("/api/entities/".length);
    const result = await mutate((db) =>
      req.method === "DELETE"
        ? ops.deleteEntity(db, user.id, kind, data)
        : ops.saveEntity(db, user.id, kind, data),
    );
    return { found: true, result };
  }
  if (path.startsWith("/api/withdraw/")) {
    const kind = path.slice("/api/withdraw/".length);
    return {
      found: true,
      result: await mutate((db) =>
        ops.withdrawEntity(db, user.id, kind, data),
      ),
    };
  }
  if (path.startsWith("/api/review/")) {
    const kind = path.slice("/api/review/".length);
    return {
      found: true,
      result: await mutate((db) => ops.reviewEntity(db, user.id, kind, data)),
    };
  }
  const routeActions = {
    "/api/plans/build": (db) => ops.buildDraft(db, user.id),
    "/api/plans/confirm": (db) => ops.confirmDraft(db, user.id, data),
    "/api/trips/transition": (db) => ops.transitionTrip(db, user.id, data),
    "/api/volunteers/availability": (db) =>
      ops.cancelVolunteer(db, user.id, data),
    "/api/plans/release": (db) => ops.releaseUnstarted(db, user.id, data),
    "/api/users": (db) => ops.saveUser(db, user.id, data),
    "/api/settings": (db) => ops.saveSettings(db, user.id, data),
  };
  const handler = routeActions[path];
  if (!handler) return { found: false };
  return { found: true, result: await mutate(handler) };
}

/**
 * Creates and configures the RescueRoute HTTP server instance.
 * Handles static asset serving, session authentication, CSRF protection,
 * public demo workspace isolation, SSE live updates, intake extraction,
 * and transactional operations.
 * @param {object} [options={}] - Server configuration options.
 * @param {string} [options.aiKey] - Gemini API key (optional; enables live AI intake).
 * @param {string} [options.aiModel] - Gemini model identifier.
 * @param {number} [options.aiTimeoutMs=8000] - Timeout in ms for Gemini API calls.
 * @param {boolean} [options.publicAiEnabled=false] - Whether live AI is enabled in public demo mode.
 * @param {typeof fetch} [options.fetcher=fetch] - Fetch implementation for dependency injection.
 * @param {Database} [options.database] - Database instance to use for local mode.
 * @param {boolean} [options.publicDemo=false] - Enables isolated per-visitor demo workspaces.
 * @param {string} [options.publicOrigin=""] - Expected public HTTPS origin when `publicDemo` is true.
 * @returns {import("node:http").Server} Configured HTTP server (not yet listening).
 */
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

  const sessionPayload = (user, csrf) => ({
    user: publicUser(user),
    csrf,
    intake: aiEnabled ? "live" : "local",
    ai: { provider: "gemini", configured: aiEnabled, model: aiModel },
    deployment,
  });

  const server = createServer(async (req, res) => {
    applySecurityHeaders(res, config.publicDemo);
    const json = (status, data) => sendJson(res, status, data);

    try {
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/health") {
        return json(200, {
          status: "ok",
          service: "RescueRoute",
          mode: deployment.mode,
        });
      }
      if (!allowedHost(req.headers.host, config)) {
        return json(403, {
          error: "This hostname is not configured for RescueRoute.",
        });
      }

      const changing = ["POST", "PATCH", "DELETE"].includes(req.method);
      if (
        changing &&
        req.method !== "POST" &&
        !(req.method === "DELETE" && path.startsWith("/api/entities/"))
      ) {
        return json(405, { error: "Method not allowed." });
      }
      if (
        changing &&
        ((req.headers.origin &&
          req.headers.origin !==
            (config.origin || `http://${req.headers.host}`)) ||
          req.headers["sec-fetch-site"] === "cross-site")
      ) {
        return json(403, { error: "Cross-origin requests are not allowed." });
      }

      if (req.method === "GET" && assets.has(path)) {
        return await serveAsset(req, res, path);
      }
      if (req.method === "GET" && path === "/api/config") {
        return json(200, { deployment });
      }

      let workspace = workspaces?.get(req.headers.cookie, false);
      if (
        publicDemo &&
        !workspace &&
        !(req.method === "POST" && path === "/api/login")
      ) {
        return json(401, {
          error:
            "Your temporary demo workspace expired. Sign in to start a fresh one.",
        });
      }

      const activeDb =
        workspace?.database ||
        (publicDemo ? workspaces.template : sharedDatabase);
      const live = workspace?.live || sharedLive;
      const intake = workspace?.intake || sharedIntake;

      if (req.method === "POST" && path === "/api/login") {
        const data = await readJsonBody(req);
        const address = req.socket.remoteAddress;
        if (!recordLoginAttempt(loginAttempts, address)) {
          return json(429, {
            error: "Too many sign-in attempts. Try again in ten minutes.",
          });
        }
        const db = activeDb.read();
        const user = db.users.find(
          (u) =>
            u.email === String(data.email).trim().toLowerCase() && u.active,
        );
        const valid = verifyPassword(
          data.password,
          user?.passwordHash || db.users[0].passwordHash,
        );
        if (!user || !valid) {
          return json(401, { error: "Email or password is incorrect." });
        }
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
        return json(200, sessionPayload(user, s.csrf));
      }

      const session = sessions.get(req.headers.cookie);
      if (!session) return json(401, { error: "Sign in to continue." });
      const currentSnap = activeDb.read();
      const user = ops.actor(currentSnap, session.userId);
      if (!sessionMatchesDb(session, user, currentSnap)) {
        // A cookie from a different isolated workspace must not revoke that
        // workspace's otherwise valid session.
        if (currentSnap.instanceId === session.instanceId) {
          sessions.delete(session.token);
        }
        return json(401, {
          error: "Your account or demo changed. Sign in again.",
        });
      }

      const mutate = (change) =>
        activeDb.transaction((db) => {
          const current = ops.actor(db, session.userId);
          if (!sessionMatchesDb(session, current, db)) {
            throw new ops.AppError(
              401,
              "Your account or demo changed. Sign in again.",
            );
          }
          return change(db);
        });

      if (req.method === "GET" && path === "/api/session") {
        return json(200, sessionPayload(user, session.csrf));
      }
      if (req.method === "GET" && path === "/api/events") {
        return live.connect(req, res, () => {
          const currentSession = sessions.get(req.headers.cookie);
          const db = activeDb.read();
          const u = db.users.find((candidate) => candidate.id === user.id);
          return (
            !!currentSession && !!u?.active && sessionMatchesDb(session, u, db)
          );
        });
      }
      if (req.method === "GET" && path === "/api/state") {
        const db = activeDb.read();
        const view = ops.stateView(db, user);
        view.deployment = deployment;
        view.mapData = live.view(db, user, view);
        return json(200, view);
      }
      if (req.method === "GET" && path === "/api/export") {
        const db = activeDb.read();
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
      if (req.headers["x-csrf-token"] !== session.csrf) {
        return json(403, {
          error: "Invalid session token. Reload and try again.",
        });
      }

      const data = await readJsonBody(req);
      const latest = activeDb.read();
      const currentUser = ops.actor(latest, user.id);
      if (
        !sessions.get(req.headers.cookie) ||
        !sessionMatchesDb(session, currentUser, latest)
      ) {
        throw new ops.AppError(401, "Your session changed. Sign in again.");
      }

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
        if (!ops.isManager(user) && user.role !== "donor") {
          return json(403, {
            error: "Only donors and coordinators can extract offers.",
          });
        }
        if (intake.busy || Date.now() - intake.last < INTAKE_COOLDOWN_MS) {
          return json(429, {
            error: "Please wait a moment before analysing another message.",
          });
        }
        intake.busy = true;
        intake.last = Date.now();
        try {
          return json(
            200,
            await intakeService.extract(data.message, {
              now: activeDb.read().settings.now,
              donors: ops
                .stateView(activeDb.read(), user)
                .donors.map((d) => ({ name: d.name })),
            }),
          );
        } finally {
          intake.busy = false;
        }
      }
      if (path === "/api/plans/preview") {
        return json(200, previewPlan(activeDb.read(), user.id, data));
      }
      if (path === "/api/reset") {
        ops.admin(user);
        if (
          data.confirm !== "RESET DEMO" ||
          !verifyPassword(
            data.password,
            activeDb.read().users.find((u) => u.id === user.id).passwordHash,
          )
        ) {
          return json(400, {
            error: "Enter RESET DEMO and your current administrator password.",
          });
        }
        const oldInstanceId = activeDb.read().instanceId;
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

      const dispatched = await dispatchMutation({
        req,
        path,
        user,
        data,
        mutate,
      });
      if (!dispatched.found) return json(404, { error: "Not found." });
      json(200, { ok: true, result: dispatched.result });
    } catch (error) {
      const status = error.status || (error instanceof InputError ? 400 : 500);
      if (status >= 500) {
        console.error("Request failed:", error.name, error.message);
      }
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
