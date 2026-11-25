/**
 * @module operations-users
 * User account administration, network settings updates, and role-filtered
 * state view projection.
 */
import { randomUUID } from "node:crypto";
import { publicUser, hashPassword } from "./auth.mjs";
import {
  activeTrip,
  actor,
  admin,
  allTrips,
  counted,
  flag,
  integer,
  isManager,
  log,
  ownership,
  quantities,
  reference,
  requireThat,
  revision,
  text,
} from "./operations-shared.mjs";

const USER_ROLES = ["admin", "coordinator", "donor", "recipient", "volunteer"];

/**
 * Creates or updates a user account. Admin-only. Enforces email uniqueness,
 * role validity, entity linking, and password strength. Increments `authVersion`
 * on password changes to invalidate existing sessions.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated admin user ID.
 * @param {{ id?: string, name: string, email: string, role: string, entityId?: string, active: boolean, password?: string, revision: number }} input - User payload.
 * @throws {AppError} 400/403/409 on validation, role, or email conflict errors.
 */
export function saveUser(db, userId, input) {
  const u = actor(db, userId);
  admin(u);
  revision(db, input.revision);
  const old = input.id && reference(db, "users", input.id);
  const email = text(input.email, "Email").toLowerCase();
  requireThat(
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),
    "Enter a valid email address.",
  );
  requireThat(
    !db.users.some((x) => x.id !== old?.id && x.email === email),
    "This email already has an account.",
  );
  const role = old ? old.role : input.role;
  requireThat(USER_ROLES.includes(role), "Select a valid role.");
  const active = flag(input.active, "Account status");
  requireThat(
    !(old?.id === u.id && !active),
    "You cannot disable your own administrator account.",
  );
  const entityId = old
    ? old.entityId
    : ["admin", "coordinator"].includes(role)
      ? null
      : input.entityId;
  if (entityId) {
    reference(
      db,
      role === "donor"
        ? "donors"
        : role === "recipient"
          ? "recipients"
          : "volunteers",
      entityId,
    );
  }
  requireThat(
    ["admin", "coordinator"].includes(role) || entityId,
    "Link this account to its organisation or volunteer.",
  );
  if (!old || input.password) {
    requireThat(
      typeof input.password === "string" &&
        input.password.length >= 10 &&
        input.password.length <= 128,
      "Use a password with 10–128 characters.",
    );
  }
  requireThat(
    old || db.users.length < 60,
    "This demo supports up to 60 accounts.",
  );
  const user = {
    id: old?.id || randomUUID(),
    name: text(input.name, "Name"),
    email,
    role,
    entityId,
    active,
    authVersion: (old?.authVersion || 0) + (input.password ? 1 : 0),
    passwordHash: input.password
      ? hashPassword(input.password)
      : old.passwordHash,
  };
  if (old) db.users[db.users.findIndex((x) => x.id === old.id)] = user;
  else db.users.push(user);
  log(
    db,
    u,
    old ? "Updated user account" : "Created user account",
    `${user.email} · ${role}`,
  );
}

/**
 * Updates network-wide settings (name, city, simulation clock).
 * Admin-only; the clock can only advance and only when no trips are active.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated admin user ID.
 * @param {{ networkName: string, city: string, now: number, revision: number }} input - Settings payload.
 * @throws {AppError} 403/409 on authorisation or active-trip conflict.
 */
export function saveSettings(db, userId, input) {
  const u = actor(db, userId);
  admin(u);
  revision(db, input.revision);
  const now = integer(input.now, db.settings.now, 1439, "Simulation clock");
  requireThat(
    !allTrips(db).some(activeTrip),
    "Finish or release all active trips before moving the simulation clock.",
    409,
  );
  db.settings = {
    ...db.settings,
    networkName: text(input.networkName, "Network name"),
    city: text(input.city, "City"),
    now,
  };
  log(
    db,
    u,
    "Updated network settings",
    `Simulation clock: ${now} minutes after midnight.`,
  );
}

/**
 * Builds a role-filtered database view for the authenticated user.
 * Coordinators and admins see everything; donors, recipients, and volunteers
 * see only their own records and the trips they are party to.
 * @param {object} db - Database snapshot.
 * @param {{ id: string, role: string, entityId?: string }} user - Authenticated user (from session).
 * @returns {object} Full filtered state payload including user, settings, entities, plans, audit, and notifications.
 * @throws {AppError} 401 if the user session is no longer active.
 */
export function stateView(db, user) {
  const u = actor(db, user.id);
  const management = isManager(u);
  const trips = allTrips(db);
  const tripVisible = (t) =>
    management ||
    (u.role === "volunteer" && t.volunteerId === u.entityId) ||
    (u.role === "donor" &&
      reference(db, "offers", t.offerId).donorId === u.entityId) ||
    (u.role === "recipient" &&
      reference(db, "requests", t.requestId).recipientId === u.entityId);

  const visibleTrips = trips.filter(tripVisible);
  const visibleOffers = db.offers
    .filter(
      (o) =>
        management ||
        ownership(u, "offers", o) ||
        visibleTrips.some((t) => t.offerId === o.id),
    )
    .map((o) => ({ ...o, ...quantities(db, "offers", o.id) }));

  const visibleRequests = db.requests
    .filter(
      (r) =>
        management ||
        ownership(u, "requests", r) ||
        visibleTrips.some((t) => t.requestId === r.id),
    )
    .map((r) => ({ ...r, ...quantities(db, "requests", r.id) }));

  const volunteers = db.volunteers
    .filter(
      (v) =>
        management ||
        ownership(u, "volunteers", v) ||
        visibleTrips.some((t) => t.volunteerId === v.id),
    )
    .map((v) =>
      management || (u.role === "volunteer" && v.id === u.entityId)
        ? v
        : { ...v, contact: undefined },
    );

  const plans = db.plans
    .filter(
      (p) =>
        management ||
        (p.status === "confirmed" && p.assignments.some(tripVisible)),
    )
    .map((p) =>
      management
        ? p
        : {
            id: p.id,
            status: p.status,
            serviceDate: p.serviceDate,
            createdAt: p.createdAt,
            confirmedAt: p.confirmedAt,
            assignments: p.assignments.filter(tripVisible),
          },
    );

  return {
    revision: db.revision,
    user: publicUser(u),
    settings: db.settings,
    donors: db.donors.filter((d) => management || ownership(u, "donors", d)),
    recipients: db.recipients.filter(
      (r) => management || ownership(u, "recipients", r),
    ),
    offers: visibleOffers,
    requests: visibleRequests,
    volunteers,
    plans,
    users: u.role === "admin" ? db.users.map(publicUser) : [],
    audit: management ? db.audit.slice(0, 200) : [],
    notifications: db.notifications
      .filter((n) =>
        n.targets.some(
          (t) =>
            t.role === u.role && (!t.entityId || t.entityId === u.entityId),
        ),
      )
      .slice(0, 50)
      .map(({ targets: _targets, ...n }) => n),
    totals: management
      ? {
          delivered: trips
            .filter((t) => t.status === "delivered")
            .reduce((n, t) => n + t.meals, 0),
          reserved: trips
            .filter((t) => activeTrip(t) && counted(t))
            .reduce((n, t) => n + t.meals, 0),
          tripsDelivered: trips.filter((t) => t.status === "delivered").length,
          pending:
            db.offers.filter((o) => o.status === "pending").length +
            db.requests.filter((r) => r.status === "pending").length,
          offered: db.offers
            .filter((o) => o.status === "approved")
            .reduce((n, o) => n + o.meals, 0),
          requested: db.requests
            .filter((r) => r.status === "approved")
            .reduce((n, r) => n + r.meals, 0),
          volunteers: db.volunteers.filter((v) => v.active).length,
        }
      : null,
  };
}
