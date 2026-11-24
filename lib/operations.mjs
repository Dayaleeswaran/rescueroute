import { randomUUID } from "node:crypto";
import { planRescue, auditPlan } from "./planner.mjs";
import { validateScenario, InputError } from "./validation.mjs";
import { publicUser, hashPassword } from "./auth.mjs";

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const requireThat = (condition, message, status = 400) => {
  if (!condition) throw new AppError(status, message);
};
export const isManager = (u) => ["admin", "coordinator"].includes(u.role);
export function actor(db, id) {
  const u = db.users.find((u) => u.id === id && u.active);
  requireThat(
    u,
    "Your session is no longer authorised. Please sign in again.",
    401,
  );
  return u;
}
export function manager(u) {
  requireThat(isManager(u), "Coordinator access is required.", 403);
}
export function admin(u) {
  requireThat(u.role === "admin", "Administrator access is required.", 403);
}
function text(value, label, max = 120) {
  requireThat(
    typeof value === "string" &&
      value.trim().length > 0 &&
      value.trim().length <= max,
    `${label} must contain 1–${max} characters.`,
  );
  return value.trim();
}
function flag(value, label) {
  requireThat(typeof value === "boolean", `${label} must be true or false.`);
  return value;
}
function notes(value) {
  requireThat(
    value === undefined || (typeof value === "string" && value.length <= 1000),
    "Notes must contain at most 1,000 characters.",
  );
  return (value || "").trim();
}
function point(value) {
  requireThat(
    Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => Number.isFinite(n) && n >= 0 && n <= 12),
    "Use two grid coordinates between 0 and 12.",
  );
  return value;
}
function integer(n, lo, hi, label) {
  requireThat(
    Number.isInteger(n) && n >= lo && n <= hi,
    `${label} must be a whole number between ${lo} and ${hi}.`,
  );
  return n;
}
function list(value, label) {
  requireThat(
    Array.isArray(value) &&
      value.length <= 16 &&
      value.every((s) => typeof s === "string" && s.trim() && s.length <= 40),
    `${label} must be a list of up to 16 short names.`,
  );
  return [...new Set(value.map((v) => v.trim().toLowerCase()))];
}
function reference(db, kind, id) {
  const record = db[kind].find((x) => x.id === id);
  requireThat(record, `${kind} record not found.`, 404);
  return record;
}
function revision(db, expected) {
  requireThat(
    expected === db.revision,
    "The network changed in another session. Refresh and review before saving.",
    409,
  );
}
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
function notify(
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
const allTrips = (db) =>
  db.plans
    .filter((p) => p.status === "confirmed")
    .flatMap((p) => p.assignments.map((t) => ({ ...t, planId: p.id })));
const counted = (t) => t.status !== "cancelled";
const activeTrip = (t) => !["cancelled", "delivered"].includes(t.status);
const carrying = (t) => ["picked_up", "awaiting_receipt"].includes(t.status);
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
function locked(db, kind, id) {
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
    city: db.settings.city,
    now: db.settings.now,
    offers: remaining("offers"),
    requests: remaining("requests"),
    volunteers,
  };
}

function ownership(u, kind, item) {
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

export function saveEntity(db, userId, kind, input) {
  const u = actor(db, userId);
  revision(db, input.revision);
  requireThat(
    ["donors", "recipients", "offers", "requests", "volunteers"].includes(kind),
    "Unknown record type.",
    404,
  );
  const old = input.id ? reference(db, kind, input.id) : null;
  if (old)
    requireThat(ownership(u, kind, old), "You cannot edit this record.", 403);
  else if (["donors", "recipients", "volunteers"].includes(kind)) manager(u);
  else
    requireThat(
      isManager(u) || u.role === (kind === "offers" ? "donor" : "recipient"),
      "You cannot create this type of record.",
      403,
    );
  if (old)
    requireThat(
      !locked(db, kind, old.id),
      "This record is reserved by an active delivery. Complete or release its trips before editing.",
      409,
    );
  requireThat(
    old || db[kind].length < 30,
    "This demo supports at most 30 records of each type.",
  );
  let item = { id: old?.id || randomUUID() };
  if (["donors", "recipients"].includes(kind)) {
    item = {
      ...item,
      name: text(input.name, "Name"),
      point: point(input.point),
      contact: text(input.contact, "Contact"),
      active: flag(input.active, "Active status"),
    };
  } else if (kind === "volunteers") {
    item = {
      ...item,
      name: text(input.name, "Name"),
      contact: text(input.contact, "Contact"),
      point: point(input.point),
      vehicle: text(input.vehicle, "Vehicle"),
      capacity: integer(input.capacity, 1, 500, "Capacity"),
      available: integer(input.available, 0, 1439, "Available time"),
      until: integer(input.until, 0, 1439, "Shift end"),
      chilled: flag(input.chilled, "Chilled capability"),
      active: flag(input.active, "Availability"),
    };
    requireThat(
      item.until >= item.available,
      "Shift end must be after availability.",
    );
    item.initials = item.name
      .split(/\s+/)
      .slice(0, 2)
      .map((v) => v[0])
      .join("")
      .toUpperCase();
  } else {
    const parentKind = kind === "offers" ? "donors" : "recipients",
      parentField = kind === "offers" ? "donorId" : "recipientId";
    const parentId = isManager(u) ? input[parentField] : u.entityId;
    if (old)
      requireThat(
        parentId === old[parentField],
        "An existing record cannot be moved to another organisation.",
      );
    const parent = reference(db, parentKind, parentId);
    requireThat(parent.active, "The organisation is inactive.");
    item = {
      ...item,
      [parentField]: parent.id,
      name: parent.name,
      point: parent.point,
      meals: integer(input.meals, 1, 1000, "Meals"),
      deadline: integer(input.deadline, db.settings.now, 1439, "Deadline"),
      notes: notes(input.notes),
      createdAt: old?.createdAt || new Date().toISOString(),
      status: "pending",
    };
    if (kind === "offers") {
      item = {
        ...item,
        food: text(input.food, "Food"),
        ready: integer(input.ready, 0, item.deadline, "Ready time"),
        deliverBy: integer(
          input.deliverBy,
          item.deadline,
          1439,
          "Use-by delivery deadline",
        ),
        maxTransitMinutes: integer(
          input.maxTransitMinutes,
          1,
          240,
          "Maximum transit time",
        ),
        allergens: list(input.allergens, "Allergens"),
        handling: input.handling,
        donorConfirmed: flag(input.donorConfirmed, "Donor confirmation"),
        verified: false,
      };
      requireThat(
        ["ambient", "chilled"].includes(item.handling),
        "Select ambient or chilled handling.",
      );
    } else
      item = {
        ...item,
        excludes: list(input.excludes, "Allergen exclusions"),
        priority: integer(input.priority, 1, 3, "Priority"),
      };
    const used = old && quantities(db, kind, old.id);
    requireThat(
      !used || used.delivered + used.reserved <= item.meals,
      "Quantity cannot be reduced below meals already delivered or reserved.",
    );
    requireThat(
      !db[kind].some(
        (x) =>
          x.id !== item.id &&
          x[parentField] === parent.id &&
          x.deadline === item.deadline &&
          (kind !== "offers" ||
            x.food.toLowerCase() === item.food.toLowerCase()) &&
          x.status !== "cancelled",
      ),
      "A matching record already exists. Edit it to avoid double-counting.",
    );
    if (isManager(u) && input.approve === true) {
      requireThat(
        kind !== "offers" || item.donorConfirmed,
        "Donor confirmation is required before approval.",
      );
      item.status = "approved";
      if (kind === "offers") item.verified = true;
    }
  }
  if (old) db[kind][db[kind].findIndex((x) => x.id === old.id)] = item;
  else db[kind].push(item);
  // Keep unreserved source locations in sync with their organisation profile.
  if (kind === "donors" || kind === "recipients")
    for (const row of db[kind === "donors" ? "offers" : "requests"])
      if (row[kind === "donors" ? "donorId" : "recipientId"] === item.id) {
        row.name = item.name;
        row.point = item.point;
      }
  validateScenario({
    now: db.settings.now,
    offers: db.offers,
    requests: db.requests,
    volunteers: db.volunteers,
  });
  log(
    db,
    u,
    `${old ? "Updated" : "Created"} ${kind}`,
    `${item.name}${item.food ? ` · ${item.food}` : ""}`,
  );
  notify(
    db,
    `${u.name} ${old ? "updated" : "submitted"} ${kind === "offers" ? "a food offer" : kind === "requests" ? "a recipient request" : item.name}.`,
  );
  return item.id;
}

export function reviewEntity(db, userId, kind, input) {
  const u = actor(db, userId);
  manager(u);
  revision(db, input.revision);
  requireThat(
    ["offers", "requests"].includes(kind),
    "Only offers and requests have an approval queue.",
  );
  const item = reference(db, kind, input.id);
  requireThat(
    !locked(db, kind, item.id),
    "This record is committed to active trips.",
    409,
  );
  requireThat(
    ["approved", "rejected", "cancelled"].includes(input.status),
    "Invalid review decision.",
  );
  if (input.status === "approved") {
    const parent = reference(
      db,
      kind === "offers" ? "donors" : "recipients",
      item[kind === "offers" ? "donorId" : "recipientId"],
    );
    requireThat(parent.active, "Activate the organisation before approving.");
    requireThat(
      kind !== "offers" || item.donorConfirmed,
      "The donor must confirm suitability and handling details first.",
    );
  }
  item.status = input.status;
  if (kind === "offers") item.verified = input.status === "approved";
  item.reviewNote = notes(input.note);
  log(
    db,
    u,
    `${input.status} ${kind}`,
    `${item.name}${item.reviewNote ? `: ${item.reviewNote}` : ""}`,
  );
  notify(
    db,
    `${item.name}: your ${kind === "offers" ? "offer" : "request"} was ${input.status}.`,
    [
      {
        role: kind === "offers" ? "donor" : "recipient",
        entityId: item[kind === "offers" ? "donorId" : "recipientId"],
      },
    ],
  );
}

export function deleteEntity(db, userId, kind, input) {
  const u = actor(db, userId);
  manager(u);
  revision(db, input.revision);
  requireThat(
    ["donors", "recipients", "offers", "requests", "volunteers"].includes(kind),
    "Unknown record type.",
  );
  const item = reference(db, kind, input.id);
  const referenced = db.plans.some((p) =>
    p.assignments.some(
      (t) =>
        t[
          kind === "offers"
            ? "offerId"
            : kind === "requests"
              ? "requestId"
              : "volunteerId"
        ] === item.id,
    ),
  );
  requireThat(
    !referenced &&
      !db.users.some((x) => x.entityId === item.id) &&
      !(kind === "donors" && db.offers.some((o) => o.donorId === item.id)) &&
      !(
        kind === "recipients" &&
        db.requests.some((r) => r.recipientId === item.id)
      ),
    "This record has linked history, users, or requests. Deactivate or cancel it instead of deleting.",
    409,
  );
  db[kind] = db[kind].filter((x) => x.id !== item.id);
  log(db, u, `Deleted ${kind}`, item.name);
}

export function withdrawEntity(db, userId, kind, input) {
  const u = actor(db, userId);
  revision(db, input.revision);
  requireThat(
    ["offers", "requests"].includes(kind),
    "Only offers and requests can be withdrawn.",
  );
  const row = reference(db, kind, input.id);
  requireThat(ownership(u, kind, row), "You cannot withdraw this record.", 403);
  requireThat(
    !locked(db, kind, row.id),
    "This record has reserved deliveries. Ask a coordinator to release uncollected trips first.",
    409,
  );
  requireThat(
    row.status !== "cancelled",
    "This record has already been withdrawn.",
    409,
  );
  row.status = "cancelled";
  if (kind === "offers") row.verified = false;
  log(db, u, `Withdrew ${kind}`, row.name);
  notify(
    db,
    `${row.name} withdrew a ${kind === "offers" ? "food offer" : "recipient request"}.`,
  );
}

export function buildDraft(db, userId) {
  const u = actor(db, userId);
  manager(u);
  const snapshot = availableScenario(db);
  const result = planRescue(snapshot);
  requireThat(
    auditPlan(snapshot, result).length === 0,
    "The draft failed its feasibility audit.",
    500,
  );
  for (const p of db.plans) if (p.status === "draft") p.status = "superseded";
  requireThat(
    db.plans.length < 200,
    "The local demo plan history is full. Export records and reset the demo to continue.",
  );
  const p = {
    ...result,
    assignments: result.assignments.map((t) => {
      const o = reference(db, "offers", t.offerId),
        r = reference(db, "requests", t.requestId),
        v = reference(db, "volunteers", t.volunteerId);
      return {
        ...t,
        donorName: o.name,
        recipientName: r.name,
        food: o.food,
        handling: o.handling,
        volunteerName: v.name,
        donorContact: reference(db, "donors", o.donorId).contact,
        recipientContact: reference(db, "recipients", r.recipientId).contact,
      };
    }),
    id: randomUUID(),
    status: "draft",
    baseRevision: db.revision + 1,
    serviceDate: db.settings.serviceDate,
    createdAt: new Date().toISOString(),
    createdBy: u.name,
    snapshot,
  };
  db.plans.unshift(p);
  log(
    db,
    u,
    "Built rescue draft",
    `${result.metrics.allocated} meals across ${result.metrics.trips} trips`,
  );
  return p.id;
}

export function confirmDraft(db, userId, input) {
  const u = actor(db, userId);
  manager(u);
  revision(db, input.revision);
  const p = reference(db, "plans", input.id);
  requireThat(p.status === "draft", "This plan is no longer a draft.", 409);
  requireThat(
    p.baseRevision === db.revision,
    "This draft is stale. Build a new draft using the current network.",
    409,
  );
  requireThat(
    p.assignments.length > 0,
    "There are no feasible trips to confirm.",
  );
  requireThat(
    auditPlan(availableScenario(db), p).length === 0,
    "Availability changed. Build a new draft.",
    409,
  );
  p.status = "confirmed";
  p.confirmedAt = new Date().toISOString();
  p.confirmedBy = u.name;
  p.assignments = p.assignments.map((t) => ({
    ...t,
    id: randomUUID(),
    status: "assigned",
    toPoint: p.snapshot.requests.find((r) => r.id === t.requestId).point,
    events: [{ status: "assigned", at: new Date().toISOString(), by: u.name }],
  }));
  log(db, u, "Confirmed rescue plan", `${p.metrics.allocated} meals reserved`);
  for (const t of p.assignments)
    notify(
      db,
      `New assignment: ${t.meals} meals, pickup at ${Math.floor(t.pickup / 60)}:${String(t.pickup % 60).padStart(2, "0")}.`,
      [
        { role: "volunteer", entityId: t.volunteerId },
        { role: "donor", entityId: reference(db, "offers", t.offerId).donorId },
        {
          role: "recipient",
          entityId: reference(db, "requests", t.requestId).recipientId,
        },
      ],
    );
}

export function transitionTrip(db, userId, input) {
  const u = actor(db, userId);
  revision(db, input.revision);
  const p = reference(db, "plans", input.planId);
  requireThat(p.status === "confirmed", "The plan is not confirmed.");
  const t = p.assignments.find((t) => t.id === input.id);
  requireThat(t, "Trip not found.", 404);
  const next = {
    assigned: "accepted",
    accepted: "picked_up",
    picked_up: "awaiting_receipt",
    awaiting_receipt: "delivered",
  }[t.status];
  requireThat(
    input.status === next && next,
    "Invalid or repeated delivery transition.",
    409,
  );
  const recipient = reference(db, "requests", t.requestId).recipientId;
  requireThat(
    isManager(u) ||
      (next === "delivered"
        ? u.role === "recipient" && u.entityId === recipient
        : u.role === "volunteer" && u.entityId === t.volunteerId),
    next === "delivered"
      ? "Only the recipient or coordinator can confirm receipt."
      : "Only the assigned volunteer or coordinator can update this trip.",
    403,
  );
  if (next === "picked_up")
    requireThat(
      !allTrips(db).some(
        (other) =>
          other.id !== t.id &&
          other.volunteerId === t.volunteerId &&
          counted(other) &&
          other.pickup < t.pickup &&
          other.status !== "delivered",
      ),
      "Finish earlier trips before collecting the next load.",
      409,
    );
  t.status = next;
  t.events.push({ status: next, at: new Date().toISOString(), by: u.name });
  if (next === "delivered") t.deliveredAt = new Date().toISOString();
  log(
    db,
    u,
    `Trip ${next.replaceAll("_", " ")}`,
    `${t.meals} meals · ${reference(db, "offers", t.offerId).name} → ${reference(db, "requests", t.requestId).name}`,
  );
  notify(db, `${t.meals}-meal delivery is now ${next.replaceAll("_", " ")}.`, [
    { role: "admin" },
    { role: "coordinator" },
    { role: "recipient", entityId: recipient },
    { role: "volunteer", entityId: t.volunteerId },
  ]);
}

export function cancelVolunteer(db, userId, input) {
  const u = actor(db, userId);
  revision(db, input.revision);
  requireThat(
    isManager(u) || (u.role === "volunteer" && u.entityId === input.id),
    "You cannot change this volunteer.",
    403,
  );
  const v = reference(db, "volunteers", input.id);
  requireThat(
    !allTrips(db).some((t) => t.volunteerId === v.id && carrying(t)),
    "This volunteer is carrying food. Complete recipient handoff before changing availability.",
    409,
  );
  v.active = flag(input.active, "Availability");
  if (!v.active)
    for (const p of db.plans.filter((p) => p.status === "confirmed"))
      for (const t of p.assignments)
        if (
          t.volunteerId === v.id &&
          ["assigned", "accepted"].includes(t.status)
        ) {
          t.status = "cancelled";
          t.events.push({
            status: "cancelled",
            at: new Date().toISOString(),
            by: u.name,
          });
        }
  log(
    db,
    u,
    v.active
      ? "Volunteer available"
      : "Volunteer cancelled; uncollected reservations released",
    v.name,
  );
  notify(
    db,
    `${v.name} is ${v.active ? "available" : "unavailable"}. Rebuild a draft to match remaining meals.`,
  );
}

export function releaseUnstarted(db, userId, input) {
  const u = actor(db, userId);
  manager(u);
  revision(db, input.revision);
  let count = 0;
  for (const p of db.plans.filter((p) => p.status === "confirmed"))
    for (const t of p.assignments)
      if (["assigned", "accepted"].includes(t.status)) {
        t.status = "cancelled";
        t.events.push({
          status: "cancelled",
          at: new Date().toISOString(),
          by: u.name,
        });
        count++;
      }
  requireThat(count > 0, "There are no uncollected reservations to release.");
  log(
    db,
    u,
    "Released uncollected reservations",
    `${count} trips; food in transit was preserved.`,
  );
}

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
  requireThat(
    ["admin", "coordinator", "donor", "recipient", "volunteer"].includes(role),
    "Select a valid role.",
  );
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
  if (entityId)
    reference(
      db,
      role === "donor"
        ? "donors"
        : role === "recipient"
          ? "recipients"
          : "volunteers",
      entityId,
    );
  requireThat(
    ["admin", "coordinator"].includes(role) || entityId,
    "Link this account to its organisation or volunteer.",
  );
  if (!old || input.password)
    requireThat(
      typeof input.password === "string" &&
        input.password.length >= 10 &&
        input.password.length <= 128,
      "Use a password with 10–128 characters.",
    );
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

export function stateView(db, user) {
  const u = actor(db, user.id),
    management = isManager(u);
  const trips = allTrips(db);
  const tripVisible = (t) =>
    management ||
    (u.role === "volunteer" && t.volunteerId === u.entityId) ||
    (u.role === "donor" &&
      reference(db, "offers", t.offerId).donorId === u.entityId) ||
    (u.role === "recipient" &&
      reference(db, "requests", t.requestId).recipientId === u.entityId);
  const visibleTrips = trips.filter(tripVisible);
  const offers = db.offers.filter(
    (o) =>
      management ||
      ownership(u, "offers", o) ||
      visibleTrips.some((t) => t.offerId === o.id),
  );
  const requests = db.requests.filter(
    (r) =>
      management ||
      ownership(u, "requests", r) ||
      visibleTrips.some((t) => t.requestId === r.id),
  );
  const visibleOffers = offers.map((o) => ({
    ...o,
    ...quantities(db, "offers", o.id),
  }));
  const visibleRequests = requests.map((r) => ({
    ...r,
    ...quantities(db, "requests", r.id),
  }));
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
      .map(({ targets, ...n }) => n),
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
