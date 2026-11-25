/**
 * @module live-network
 * Real-time network layer for RescueRoute using Server-Sent Events (SSE).
 * Manages live SSE client connections, broadcasts database revision updates,
 * accepts volunteer GPS fixes and demo tracking movements, and builds the
 * map view payload for the coordinator dashboard. Connections are capped at
 * 32 to prevent resource exhaustion; slow consumers are disconnected rather
 * than backpressured.
 */
import { AppError, isManager } from "./operations.mjs";
import { coordinates, demoCoordinates, validCoordinates } from "./geo.mjs";

const ACTIVE = new Set([
  "assigned",
  "accepted",
  "picked_up",
  "awaiting_receipt",
]);
/**
 * Real-time event hub that pairs the RescueRoute database with SSE clients.
 * Subscribe to database changes, broadcast events to all connected clients,
 * and manage volunteer GPS and demo-tracking fixes.
 */
export class LiveNetwork {
  /**
   * @param {import('./database.mjs').Database} database - Live database instance.
   * @param {function(): number} [now=Date.now] - Clock function for fix timestamp tracking.
   */
  constructor(database, now = Date.now) {
    this.database = database;
    this.now = now;
    this.fixes = new Map();
    this.clients = new Set();
    this.unsubscribe = database.subscribe((revision) =>
      this.broadcast("network", { revision }),
    );
  }
  /**
   * Writes an SSE message to a single client. Removes the client and returns false
   * if the response has ended or write throws (disconnected socket).
   * @param {{ res: import('http').ServerResponse, valid: function(): boolean }} client - Connected client.
   * @param {string} message - Raw SSE message string to write.
   * @returns {boolean} True if the write succeeded.
   */
  send(client, message) {
    const { res } = client;
    if (res.destroyed || res.writableEnded) {
      this.clients.delete(client);
      return false;
    }
    try {
      if (res.write(message)) return true;
    } catch {
      // A disconnected socket must not interrupt other visitors' updates.
    }
    // Do not queue subsequent events behind a slow consumer. EventSource
    // reconnects and the interface fetches the current authorised snapshot.
    res.destroy();
    this.clients.delete(client);
    return false;
  }
  /**
   * Broadcasts an SSE event to all connected clients. Clients with expired sessions
   * receive a `session-expired` event and are disconnected.
   * @param {string} event - SSE event name.
   * @param {object} payload - JSON-serialisable event payload.
   */
  broadcast(event, payload) {
    for (const client of [...this.clients]) {
      if (!client.valid()) {
        if (this.send(client, "event: session-expired\ndata: {}\n\n"))
          client.res.end();
        this.clients.delete(client);
      } else
        this.send(
          client,
          `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
        );
    }
  }
  /**
   * Upgrades an HTTP response to an SSE stream and registers the client.
   * Sets required headers, starts a 15-second heartbeat, and sends an initial
   * `connected` event. Throws 429 if the connection cap is reached.
   * @param {import('http').IncomingMessage} req - Incoming HTTP request.
   * @param {import('http').ServerResponse} res - HTTP response to upgrade.
   * @param {function(): boolean} valid - Returns false when the session has expired.
   * @throws {AppError} 429 if more than 32 clients are already connected.
   */
  connect(req, res, valid) {
    if (this.clients.size >= 32)
      throw new AppError(
        429,
        "Too many live connections. Close an unused tab.",
      );
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const client = { res, valid };
    this.clients.add(client);
    const timer = setInterval(() => {
      if (!valid()) {
        if (this.send(client, "event: session-expired\ndata: {}\n\n"))
          res.end();
      } else this.send(client, ": heartbeat\n\n");
    }, 15000);
    timer.unref();
    res.on("close", () => {
      clearInterval(timer);
      this.clients.delete(client);
    });
    this.send(client, "event: connected\ndata: {}\n\n");
  }
  /**
   * Closes all SSE connections, unsubscribes from the database, and clears all GPS fixes.
   * Should be called on server shutdown or when a demo workspace is evicted.
   */
  close() {
    this.unsubscribe();
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    this.fixes.clear();
  }
  /**
   * Retrieves a fresh GPS/demo fix for a volunteer, or null if expired or invalidated.
   * Fixes expire after 10 minutes; GPS fixes are additionally invalidated if the
   * owning user's auth version has changed.
   * @param {string} id - Volunteer entity ID.
   * @returns {{ coordinates: number[], accuracy: number|null, mode: string, fresh: boolean }|null} The fix, or null.
   */
  fix(id) {
    const f = this.fixes.get(id);
    if (!f) return null;
    if (this.now() - f.receivedAt > 600000) {
      this.fixes.delete(id);
      return null;
    }
    if (f.mode === "gps") {
      const owner = this.database.read().users.find((u) => u.id === f.ownerId);
      if (!owner?.active || (owner.authVersion || 0) !== f.authVersion)
        return null;
    }
    return { ...f, fresh: this.now() - f.receivedAt <= 120000 };
  }
  /**
   * Accepts a GPS location update from an authenticated volunteer.
   * Rate-limited to one update per 2 seconds per volunteer. Broadcasts a
   * `tracking` event to all connected clients on success.
   * @param {{ id: string, role: string, entityId: string, authVersion?: number }} user - The authenticated volunteer.
   * @param {{ latitude: number, longitude: number, accuracy: number }} input - GPS reading.
   * @throws {AppError} 403 if not a volunteer; 400 if coordinates or accuracy are invalid; 429 if rate-limited.
   */
  gps(user, input) {
    if (user.role !== "volunteer")
      throw new AppError(
        403,
        "Only volunteers can share their own GPS location.",
      );
    const location = [input.latitude, input.longitude];
    if (
      !validCoordinates(location) ||
      !Number.isFinite(input.accuracy) ||
      input.accuracy < 0 ||
      input.accuracy > 100000
    )
      throw new AppError(
        400,
        "A valid location and accuracy in metres are required.",
      );
    const prior = this.fix(user.entityId);
    if (prior?.mode === "gps" && this.now() - prior.receivedAt < 2000)
      throw new AppError(
        429,
        "Location updates are limited to one every two seconds.",
      );
    this.fixes.set(user.entityId, {
      coordinates: location,
      accuracy: input.accuracy,
      receivedAt: this.now(),
      mode: "gps",
      ownerId: user.id,
      authVersion: user.authVersion || 0,
    });
    this.broadcast("tracking", {});
  }
  /**
   * Stops GPS sharing for a volunteer (self-stop) or removes a demo fix (coordinator).
   * @param {{ id: string, role: string, entityId: string }} user - The authenticated user.
   * @param {string} [id=user.entityId] - The volunteer entity ID whose fix should be removed.
   * @throws {AppError} 403 if the user is neither the volunteer nor a coordinator acting on a demo fix.
   */
  stop(user, id = user.entityId) {
    const f = this.fix(id);
    if (
      !(user.role === "volunteer" && user.entityId === id) &&
      !(isManager(user) && f?.mode === "demo")
    )
      throw new AppError(
        403,
        "You can stop your own GPS sharing or a demo tracker.",
      );
    this.fixes.delete(id);
    this.broadcast("tracking", {});
  }
  /**
   * Removes all GPS fixes owned by the logging-out user and broadcasts a tracking update.
   * @param {{ id: string }} user - The user who is logging out.
   */
  logout(user) {
    for (const [id, f] of this.fixes)
      if (f.ownerId === user.id) this.fixes.delete(id);
    this.broadcast("tracking", {});
  }
  /**
   * Simulates a volunteer's position along a planning trip route for demo purposes.
   * Requires coordinator access. Cannot override a live GPS fix.
   * @param {{ id: string, role: string }} user - The coordinator user.
   * @param {{ id: string, progress: number }} input - Volunteer ID and progress fraction (0–1).
   * @throws {AppError} 403 if not a coordinator; 400 if volunteer or progress is invalid; 409 if a live GPS fix exists.
   */
  demo(user, input) {
    if (!isManager(user))
      throw new AppError(
        403,
        "Coordinator access is required for demo tracking.",
      );
    const db = this.database.read(),
      v = db.volunteers.find((v) => v.id === input.id && v.active);
    if (
      !v ||
      !Number.isFinite(input.progress) ||
      input.progress < 0 ||
      input.progress > 1
    )
      throw new AppError(
        400,
        "Choose an available volunteer and a progress fraction from zero to one.",
      );
    if (this.fix(v.id)?.mode === "gps")
      throw new AppError(
        409,
        "A shared GPS fix exists. Demo movement cannot replace real shared GPS.",
      );
    const p = db.plans.find(
      (p) =>
        ["confirmed", "draft"].includes(p.status) &&
        p.assignments.some(
          (t) => t.volunteerId === v.id && (!t.status || ACTIVE.has(t.status)),
        ),
    );
    const t = p?.assignments
      .filter(
        (t) => t.volunteerId === v.id && (!t.status || ACTIVE.has(t.status)),
      )
      .sort((a, b) => a.pickup - b.pickup)[0];
    let route;
    if (t) {
      const convert =
        p.snapshot.coordinateSystem === "geo"
          ? (point) => point
          : demoCoordinates;
      route = [
        convert(t.from),
        convert(p.snapshot.offers.find((o) => o.id === t.offerId).point),
        convert(p.snapshot.requests.find((r) => r.id === t.requestId).point),
      ];
    } else {
      const start = coordinates(v);
      route = [
        start,
        [start[0] + 0.006, start[1] + 0.008],
        [start[0] + 0.01, start[1] + 0.003],
      ];
    }
    const leg = input.progress < 0.5 ? 0 : 1,
      f = leg ? (input.progress - 0.5) * 2 : input.progress * 2;
    const location = route[leg].map((n, i) => n + (route[leg + 1][i] - n) * f);
    this.fixes.set(v.id, {
      coordinates: location,
      accuracy: null,
      receivedAt: this.now(),
      mode: "demo",
      description: t
        ? "Simulated movement along a planning link"
        : "Simulated loop; no assigned delivery",
    });
    this.broadcast("tracking", {});
  }
  /**
   * Builds the map view payload for the coordinator dashboard.
   * Returns entities (donors, recipients, volunteers with optional GPS fixes),
   * active planning links, and tile/attribution metadata.
   * GPS fixes are only included for the requesting user's own volunteer entry
   * or for volunteers assigned to active confirmed trips (for coordinators: all).
   * @param {object} db - Database snapshot from `Database.read()`.
   * @param {{ id: string, role: string, entityId?: string }} user - The requesting user.
   * @param {object} view - Pre-filtered view object from operations (donors, offers, recipients, requests, volunteers, plans).
   * @returns {{ entities: object[], links: object[], asOf: number, tileUrl: string, attribution: string, demoArea: string }} Map payload.
   */
  view(db, user, view) {
    const entities = [];
    const entry = (kind, profile, extra) => ({
      kind,
      id: profile.id,
      name: profile.name,
      coordinates: coordinates(profile),
      locationType: profile.geo ? "manual" : "demo",
      locationLabel: profile.locationLabel || "",
      active: profile.active,
      ...extra,
    });
    for (const d of db.donors.filter(
      (d) =>
        view.donors.some((x) => x.id === d.id) ||
        view.offers.some((o) => o.donorId === d.id),
    ))
      entities.push(
        entry("donor", d, {
          contact: d.contact,
          offers: view.offers.filter((o) => o.donorId === d.id),
        }),
      );
    for (const r of db.recipients.filter(
      (r) =>
        view.recipients.some((x) => x.id === r.id) ||
        view.requests.some((q) => q.recipientId === r.id),
    ))
      entities.push(
        entry("recipient", r, {
          contact: r.contact,
          requests: view.requests.filter((q) => q.recipientId === r.id),
        }),
      );
    for (const v of view.volunteers) {
      const visible =
        isManager(user) ||
        (user.role === "volunteer" && user.entityId === v.id) ||
        view.plans.some(
          (p) =>
            p.status === "confirmed" &&
            p.assignments.some(
              (t) => t.volunteerId === v.id && ACTIVE.has(t.status),
            ),
        );
      const fix = visible ? this.fix(v.id) : null;
      const publicFix = fix && {
        coordinates: fix.coordinates,
        mode: fix.mode,
        accuracy: fix.accuracy,
        receivedAt: fix.receivedAt,
        fresh: fix.fresh,
        description: fix.description,
      };
      entities.push(
        entry("volunteer", v, {
          contact: v.contact,
          capacity: v.capacity,
          vehicle: v.vehicle,
          chilled: v.chilled,
          available: v.available,
          until: v.until,
          fix: publicFix,
        }),
      );
    }
    const plans = view.plans.filter(
      (p) =>
        p.status === "confirmed" &&
        p.assignments.some((t) => ACTIVE.has(t.status)),
    );
    if (!plans.length) {
      const draft = view.plans.find((p) => p.status === "draft");
      if (draft) plans.push(draft);
    }
    const links = plans.flatMap((p) =>
      p.assignments
        .filter((t) => !t.status || ACTIVE.has(t.status))
        .map((t) => {
          const full = db.plans.find((full) => full.id === p.id),
            convert =
              full.snapshot.coordinateSystem === "geo"
                ? (point) => point
                : demoCoordinates;
          return {
            id: t.id,
            volunteerId: t.volunteerId,
            label: `${t.meals} meals · planning link`,
            points: [
              convert(t.from),
              convert(
                full.snapshot.offers.find((o) => o.id === t.offerId).point,
              ),
              convert(
                full.snapshot.requests.find((r) => r.id === t.requestId).point,
              ),
            ],
          };
        }),
    );
    return {
      entities,
      links,
      asOf: this.now(),
      tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      attribution: "© OpenStreetMap contributors",
      demoArea:
        "Illustrative placements near Colombo, Sri Lanka. These are fictional organisations.",
    };
  }
}
