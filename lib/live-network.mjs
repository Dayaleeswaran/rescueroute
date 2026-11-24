import { AppError, isManager } from "./operations.mjs";
import { coordinates, demoCoordinates, validCoordinates } from "./geo.mjs";

const ACTIVE = new Set([
  "assigned",
  "accepted",
  "picked_up",
  "awaiting_receipt",
]);
export class LiveNetwork {
  constructor(database, now = Date.now) {
    this.database = database;
    this.now = now;
    this.fixes = new Map();
    this.clients = new Set();
    this.unsubscribe = database.subscribe((revision) =>
      this.broadcast("network", { revision }),
    );
  }
  broadcast(event, payload) {
    for (const client of [...this.clients]) {
      if (!client.valid()) {
        client.res.write("event: session-expired\ndata: {}\n\n");
        client.res.end();
        this.clients.delete(client);
      } else
        client.res.write(
          `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`,
        );
    }
  }
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
    res.write("event: connected\ndata: {}\n\n");
    const client = { res, valid };
    this.clients.add(client);
    const timer = setInterval(() => {
      if (!valid()) {
        res.write("event: session-expired\ndata: {}\n\n");
        res.end();
      } else res.write(": heartbeat\n\n");
    }, 15000);
    timer.unref();
    res.on("close", () => {
      clearInterval(timer);
      this.clients.delete(client);
    });
  }
  close() {
    this.unsubscribe();
    for (const c of this.clients) c.res.end();
    this.clients.clear();
    this.fixes.clear();
  }
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
  logout(user) {
    for (const [id, f] of this.fixes)
      if (f.ownerId === user.id) this.fixes.delete(id);
    this.broadcast("tracking", {});
  }
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
