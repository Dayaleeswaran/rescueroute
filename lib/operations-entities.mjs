/**
 * @module operations-entities
 * CRUD, approval-queue review, hard deletion, and self-withdrawal operations
 * for donors, recipients, volunteers, offers, and requests.
 */
import { randomUUID } from "node:crypto";
import { validateScenario } from "./validation.mjs";
import { validCoordinates } from "./geo.mjs";
import {
  actor,
  flag,
  integer,
  isManager,
  list,
  locked,
  log,
  manager,
  notes,
  notify,
  ownership,
  point,
  quantities,
  reference,
  requireThat,
  revision,
  text,
} from "./operations-shared.mjs";

const ALL_ENTITY_KINDS = [
  "donors",
  "recipients",
  "offers",
  "requests",
  "volunteers",
];
const PROFILE_KINDS = ["donors", "recipients", "volunteers"];

function buildVolunteerRecord(base, input) {
  const record = {
    ...base,
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
    record.until >= record.available,
    "Shift end must be after availability.",
  );
  record.initials = record.name
    .split(/\s+/)
    .slice(0, 2)
    .map((v) => v[0])
    .join("")
    .toUpperCase();
  return record;
}

function buildOrderRecord(db, u, kind, base, input, old) {
  const parentKind = kind === "offers" ? "donors" : "recipients";
  const parentField = kind === "offers" ? "donorId" : "recipientId";
  const parentId = isManager(u) ? input[parentField] : u.entityId;
  if (old) {
    requireThat(
      parentId === old[parentField],
      "An existing record cannot be moved to another organisation.",
    );
  }
  const parent = reference(db, parentKind, parentId);
  requireThat(parent.active, "The organisation is inactive.");

  let item = {
    ...base,
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
  } else {
    item = {
      ...item,
      excludes: list(input.excludes, "Allergen exclusions"),
      priority: integer(input.priority, 1, 3, "Priority"),
    };
  }

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
  return item;
}

/**
 * Creates or updates a donor, recipient, offer, request, or volunteer record.
 * Enforces role-based ownership, revision locking, duplicate detection, and
 * optional coordinator approval in a single transaction-safe pass.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated user ID.
 * @param {"donors"|"recipients"|"offers"|"requests"|"volunteers"} kind - Record type.
 * @param {object} input - Record payload including `revision` and optional `id` for updates.
 * @returns {string} The ID of the created or updated record.
 * @throws {AppError} 400/403/404/409 on validation, authorisation, or conflict errors.
 */
export function saveEntity(db, userId, kind, input) {
  const u = actor(db, userId);
  revision(db, input.revision);
  requireThat(ALL_ENTITY_KINDS.includes(kind), "Unknown record type.", 404);

  const old = input.id ? reference(db, kind, input.id) : null;
  if (old) {
    requireThat(ownership(u, kind, old), "You cannot edit this record.", 403);
    requireThat(
      !locked(db, kind, old.id),
      "This record is reserved by an active delivery. Complete or release its trips before editing.",
      409,
    );
  } else if (PROFILE_KINDS.includes(kind)) {
    manager(u);
  } else {
    requireThat(
      isManager(u) || u.role === (kind === "offers" ? "donor" : "recipient"),
      "You cannot create this type of record.",
      403,
    );
  }

  requireThat(
    old || db[kind].length < 30,
    "This demo supports at most 30 records of each type.",
  );

  const base = { id: old?.id || randomUUID() };
  let item;
  if (["donors", "recipients"].includes(kind)) {
    item = {
      ...base,
      name: text(input.name, "Name"),
      point: point(input.point),
      contact: text(input.contact, "Contact"),
      active: flag(input.active, "Active status"),
    };
  } else if (kind === "volunteers") {
    item = buildVolunteerRecord(base, input);
  } else {
    item = buildOrderRecord(db, u, kind, base, input, old);
  }

  if (PROFILE_KINDS.includes(kind)) {
    const geo = input.geo === undefined ? (old?.geo ?? null) : input.geo;
    requireThat(
      geo === null || validCoordinates(geo),
      "Use a latitude between -85 and 85 and longitude between -180 and 180.",
    );
    item.geo = geo;
    item.locationLabel = notes(input.locationLabel ?? old?.locationLabel).slice(
      0,
      180,
    );
  }

  if (old) db[kind][db[kind].findIndex((x) => x.id === old.id)] = item;
  else db[kind].push(item);

  // Keep unreserved source locations in sync with their organisation profile.
  if (kind === "donors" || kind === "recipients") {
    const childKind = kind === "donors" ? "offers" : "requests";
    const childField = kind === "donors" ? "donorId" : "recipientId";
    for (const row of db[childKind]) {
      if (row[childField] === item.id) {
        row.name = item.name;
        row.point = item.point;
      }
    }
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

/**
 * Reviews (approves, rejects, or cancels) an offer or request record.
 * Requires coordinator access; enforces activation and donor-confirmation checks.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated user ID.
 * @param {"offers"|"requests"} kind - Record type.
 * @param {{ id: string, revision: number, status: string, note?: string }} input - Review input.
 * @throws {AppError} 403/409 on authorisation or conflict errors.
 */
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

/**
 * Permanently deletes a record if it has no linked plans, users, or child records.
 * Requires coordinator access. Linked records must be deactivated or cancelled instead.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated user ID.
 * @param {"donors"|"recipients"|"offers"|"requests"|"volunteers"} kind - Record type.
 * @param {{ id: string, revision: number }} input - Deletion input.
 * @throws {AppError} 403/409 if access is denied or the record has linked history.
 */
export function deleteEntity(db, userId, kind, input) {
  const u = actor(db, userId);
  manager(u);
  revision(db, input.revision);
  requireThat(ALL_ENTITY_KINDS.includes(kind), "Unknown record type.");
  const item = reference(db, kind, input.id);
  const tripField =
    kind === "offers"
      ? "offerId"
      : kind === "requests"
        ? "requestId"
        : "volunteerId";
  const referenced = db.plans.some((p) =>
    p.assignments.some((t) => t[tripField] === item.id),
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

/**
 * Cancels an offer or request owned by the requesting user (self-withdrawal).
 * Records with active trip reservations cannot be withdrawn until trips are released.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated user ID.
 * @param {"offers"|"requests"} kind - Record type.
 * @param {{ id: string, revision: number }} input - Withdrawal input.
 * @throws {AppError} 403/409 on authorisation or conflict errors.
 */
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
