/**
 * @module operations-shared
 * Shared errors, role guards, input validators, audit/notification helpers,
 * trip reservation queries, and scenario projection for RescueRoute operations.
 */
import { randomUUID } from "node:crypto";
import { coordinates, demoCoordinates } from "./geo.mjs";

/**
 * Application-level error carrying an HTTP status code.
 * Thrown by all operations functions on authorisation or validation failures.
 */
export class AppError extends Error {
  /**
   * @param {number} status - HTTP status code.
   * @param {string} message - User-facing error message.
   */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Asserts a condition, throwing {@link AppError} when falsy.
 * @param {unknown} condition - Condition to assert.
 * @param {string} message - Error message when condition fails.
 * @param {number} [status=400] - HTTP status code.
 */
export const requireThat = (condition, message, status = 400) => {
  if (!condition) throw new AppError(status, message);
};

/**
 * Returns true when the user has coordinator or admin privileges.
 * @param {{ role: string }} u - User record.
 * @returns {boolean}
 */
export const isManager = (u) => ["admin", "coordinator"].includes(u.role);

/**
 * Looks up an active user by ID in the database snapshot.
 * @param {object} db - Database snapshot.
 * @param {string} id - User ID from the authenticated session.
 * @returns {object} The active user record.
 * @throws {AppError} 401 if the user is not found or inactive.
 */
export function actor(db, id) {
  const u = db.users.find((candidate) => candidate.id === id && candidate.active);
  requireThat(
    u,
    "Your session is no longer authorised. Please sign in again.",
    401,
  );
  return u;
}

/**
 * Asserts that the given user has coordinator or admin privileges.
 * @param {object} u - User record (from {@link actor}).
 * @throws {AppError} 403 if the user is not a manager.
 */
export function manager(u) {
  requireThat(isManager(u), "Coordinator access is required.", 403);
}

/**
 * Asserts that the given user has admin privileges.
 * @param {object} u - User record (from {@link actor}).
 * @throws {AppError} 403 if the user is not an admin.
 */
export function admin(u) {
  requireThat(u.role === "admin", "Administrator access is required.", 403);
}

/**
 * Validates and trims a required non-empty string within `max` characters.
 * @param {unknown} value - Input value.
 * @param {string} label - Field label for error messages.
 * @param {number} [max=120] - Maximum trimmed length.
 * @returns {string}
 */
export function text(value, label, max = 120) {
  requireThat(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max,
    `${label} must contain 1–${max} characters.`,
  );
  return value.trim();
}

/**
 * Validates a strict boolean flag.
 * @param {unknown} value - Input value.
 * @param {string} label - Field label for error messages.
 * @returns {boolean}
 */
export function flag(value, label) {
  requireThat(typeof value === "boolean", `${label} must be true or false.`);
  return value;
}

/**
 * Validates optional notes text up to 1,000 characters.
 * @param {unknown} value - Input value.
 * @returns {string}
 */
export function notes(value) {
  requireThat(
    value === undefined || (typeof value === "string" && value.length <= 1000),
    "Notes must contain at most 1,000 characters.",
  );
  return (value || "").trim();
}

/**
 * Validates a 2D `[x, y]` grid coordinate pair in `[0, 12]`.
 * @param {unknown} value - Input value.
 * @returns {number[]}
 */
export function point(value) {
  requireThat(
    Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => Number.isFinite(n) && n >= 0 && n <= 12),
    "Use two grid coordinates between 0 and 12.",
  );
  return value;
}

/**
 * Validates an integer within `[lo, hi]`.
 * @param {unknown} n - Input value.
 * @param {number} lo - Inclusive minimum.
 * @param {number} hi - Inclusive maximum.
 * @param {string} label - Field label for error messages.
 * @returns {number}
 */
export function integer(n, lo, hi, label) {
  requireThat(
    Number.isInteger(n) && n >= lo && n <= hi,
    `${label} must be a whole number between ${lo} and ${hi}.`,
  );
  return n;
}

/**
 * Validates and deduplicates a list of up to 16 short lowercase strings.
 * @param {unknown} value - Input array.
 * @param {string} label - Field label for error messages.
 * @returns {string[]}
 */
export function list(value, label) {
  requireThat(
    Array.isArray(value) &&
      value.length <= 16 &&
      value.every((s) => typeof s === "string" && s.trim() && s.length <= 40),
    `${label} must be a list of up to 16 short names.`,
  );
  return [...new Set(value.map((v) => v.trim().toLowerCase()))];
}

/**
 * Looks up a record by collection kind and ID, throwing 404 if missing.
 * @param {object} db - Database snapshot.
 * @param {string} kind - Collection name on `db`.
 * @param {string} id - Record ID.
 * @returns {object}
 */
export function reference(db, kind, id) {
  const record = db[kind].find((x) => x.id === id);
  requireThat(record, `${kind} record not found.`, 404);
  return record;
}

/**
 * Enforces optimistic concurrency by comparing `expected` against `db.revision`.
 * @param {object} db - Database snapshot.
 * @param {unknown} expected - Client-supplied revision number.
 */
export function revision(db, expected) {
  requireThat(
    expected === db.revision,
    "The network changed in another session. Refresh and review before saving.",
    409,
  );
}

/**
 * Appends an audit log entry to the database, capped at 1,500 records.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {object} u - The acting user.
 * @param {string} action - Short description of the action taken.
 * @param {string} [detail=""] - Optional longer detail string.
 */
export function log(db, u, action, detail = "") {
  db.audit.unshift({
    id: randomUUID(),
    at: new Date().toISOString(),
    actor: u.name,
    actorId: u.id,
    action,
    detail,
  });
  db.audit = db.audit.slice(0, 1500);
}

/**
 * Prepends a notification targeted to specific roles or entity IDs, capped at 250.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} title - Notification text.
 * @param {Array<{ role: string, entityId?: string }>} [targets] - Recipient targets.
 */
export function notify(
  db,
  title,
  targets = [{ role: "admin" }, { role: "coordinator" }],
) {
  db.notifications.unshift({
    id: randomUUID(),
    at: new Date().toISOString(),
    title,
    targets,
  });
  db.notifications = db.notifications.slice(0, 250);
}

/**
 * Returns all trip assignments across confirmed plans with `planId` attached.
 * @param {object} db - Database snapshot.
 * @returns {object[]}
 */
export const allTrips = (db) =>
  db.plans
    .filter((p) => p.status === "confirmed")
    .flatMap((p) => p.assignments.map((t) => ({ ...t, planId: p.id })));

/** Returns true when a trip is not cancelled. */
export const counted = (t) => t.status !== "cancelled";

/** Returns true when a trip is neither cancelled nor delivered. */
export const activeTrip = (t) => !["cancelled", "delivered"].includes(t.status);

/** Returns true when a volunteer is currently carrying food on a trip. */
export const carrying = (t) =>
  ["picked_up", "awaiting_receipt"].includes(t.status);

/**
 * Returns the delivered and reserved meal quantities for a given offer or request.
 * @param {object} db - Database snapshot.
 * @param {"offers"|"requests"} kind - Record type.
 * @param {string} id - Record ID.
 * @returns {{ delivered: number, reserved: number }} Quantity summary.
 */
export function quantities(db, kind, id) {
  const field = kind === "offers" ? "offerId" : "requestId";
  const trips = allTrips(db).filter((t) => t[field] === id && counted(t));
  return {
    delivered: trips
      .filter((t) => t.status === "delivered")
      .reduce((n, t) => n + t.meals, 0),
    reserved: trips.filter(activeTrip).reduce((n, t) => n + t.meals, 0),
  };
}

/**
 * Checks whether a record is referenced by any active confirmed trip.
 * @param {object} db - Database snapshot.
 * @param {"offers"|"requests"|"volunteers"|"donors"|"recipients"} kind - Record type.
 * @param {string} id - Record ID.
 * @returns {boolean}
 */
export function locked(db, kind, id) {
  return allTrips(db).some(
    (t) =>
      activeTrip(t) &&
      (kind === "offers"
        ? t.offerId === id
        : kind === "requests"
          ? t.requestId === id
          : kind === "volunteers"
            ? t.volunteerId === id
            : kind === "donors"
              ? reference(db, "offers", t.offerId).donorId === id
              : reference(db, "requests", t.requestId).recipientId === id),
  );
}

/**
 * Checks whether user `u` owns or manages the given entity record.
 * @param {object} u - Acting user.
 * @param {string} kind - Collection kind.
 * @param {object} item - Target record.
 * @returns {boolean}
 */
export function ownership(u, kind, item) {
  if (isManager(u)) return true;
  if (kind === "offers")
    return u.role === "donor" && item.donorId === u.entityId;
  if (kind === "requests")
    return u.role === "recipient" && item.recipientId === u.entityId;
  if (kind === "volunteers")
    return u.role === "volunteer" && item.id === u.entityId;
  return (
    ((kind === "donors" && u.role === "donor") ||
      (kind === "recipients" && u.role === "recipient")) &&
    item.id === u.entityId
  );
}

/**
 * Builds the available planning scenario from the current database state.
 * Deducts already-reserved and delivered quantities, advances volunteer start
 * positions to their last confirmed delivery point, and resolves all coordinates.
 * @param {object} db - Database snapshot.
 * @returns {object} A validated scenario object ready for {@link module:planner}.
 */
export function availableScenario(db) {
  const remaining = (kind) =>
    db[kind]
      .filter(
        (x) =>
          x.status === "approved" &&
          (kind === "offers"
            ? reference(db, "donors", x.donorId).active
            : reference(db, "recipients", x.recipientId).active),
      )
      .map((x) => {
        const used = quantities(db, kind, x.id);
        return { ...x, meals: x.meals - used.reserved - used.delivered };
      })
      .filter((x) => x.meals > 0);

  const volunteers = db.volunteers
    .map((v) => {
      const prior = allTrips(db)
        .filter((t) => t.volunteerId === v.id && counted(t))
        .sort((a, b) => a.delivery - b.delivery)
        .at(-1);
      return prior
        ? {
            ...v,
            point: prior.toPoint,
            available: Math.max(v.available, prior.delivery),
          }
        : v;
    })
    .filter((v) => v.available <= v.until);

  return {
    coordinateSystem: "geo",
    city: db.settings.city,
    now: db.settings.now,
    offers: remaining("offers").map((o) => ({
      ...o,
      point: coordinates(reference(db, "donors", o.donorId)),
    })),
    requests: remaining("requests").map((r) => ({
      ...r,
      point: coordinates(reference(db, "recipients", r.recipientId)),
    })),
    volunteers: volunteers.map((v) => {
      const prior = db.plans
        .filter((p) => p.status === "confirmed")
        .flatMap((p) =>
          p.assignments
            .filter((t) => t.volunteerId === v.id && t.status !== "cancelled")
            .map((t) => ({
              ...t,
              geographic: p.snapshot?.coordinateSystem === "geo",
            })),
        )
        .sort((a, b) => a.delivery - b.delivery)
        .at(-1);
      return {
        ...v,
        point: prior
          ? prior.geographic
            ? prior.toPoint
            : demoCoordinates(prior.toPoint)
          : coordinates(reference(db, "volunteers", v.id)),
      };
    }),
  };
}
