/**
 * @module operations-plans
 * Rescue plan lifecycle operations: building audited drafts, confirming plans,
 * transitioning trip delivery states, and releasing uncollected reservations.
 */
import { randomUUID } from "node:crypto";
import { planRescue, auditPlan } from "./planner.mjs";
import {
  actor,
  allTrips,
  availableScenario,
  carrying,
  counted,
  flag,
  isManager,
  log,
  manager,
  notify,
  reference,
  requireThat,
  revision,
} from "./operations-shared.mjs";

const TRIP_NEXT_STATUS = {
  assigned: "accepted",
  accepted: "picked_up",
  picked_up: "awaiting_receipt",
  awaiting_receipt: "delivered",
};

/**
 * Runs the rescue planner over the current available scenario and stores the result
 * as a new draft plan. Supersedes any previous draft. Passes an independent audit.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated coordinator user ID.
 * @returns {string} The ID of the newly created draft plan.
 * @throws {AppError} 403 if not a coordinator; 500 if the plan fails its audit.
 */
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
      const o = reference(db, "offers", t.offerId);
      const r = reference(db, "requests", t.requestId);
      const v = reference(db, "volunteers", t.volunteerId);
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

/**
 * Confirms a draft plan, locking in all trip assignments and notifying stakeholders.
 * Re-audits the plan against current availability before confirming to catch changes.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated coordinator user ID.
 * @param {{ id: string, revision: number }} input - Plan ID and current revision.
 * @throws {AppError} 403/409 if access is denied, the plan is stale, or availability changed.
 */
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
  for (const t of p.assignments) {
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
}

/**
 * Advances a confirmed trip through its delivery status lifecycle:
 * `assigned` → `accepted` → `picked_up` → `awaiting_receipt` → `delivered`.
 * Enforces role-based access: volunteers advance up to handoff; recipients confirm delivery.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated user ID.
 * @param {{ planId: string, id: string, revision: number, status: string }} input - Transition input.
 * @throws {AppError} 403/404/409 on authorisation, sequence, or ordering errors.
 */
export function transitionTrip(db, userId, input) {
  const u = actor(db, userId);
  revision(db, input.revision);
  const p = reference(db, "plans", input.planId);
  requireThat(p.status === "confirmed", "The plan is not confirmed.");
  const t = p.assignments.find((trip) => trip.id === input.id);
  requireThat(t, "Trip not found.", 404);
  const next = TRIP_NEXT_STATUS[t.status];
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
  if (next === "picked_up") {
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
  }
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

/**
 * Sets a volunteer's active status and cancels all uncollected assigned trips
 * when deactivating. Prevents deactivation while the volunteer is carrying food.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated user ID.
 * @param {{ id: string, revision: number, active: boolean }} input - Availability input.
 * @throws {AppError} 403/409 on authorisation or carrying-food conflict.
 */
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
  if (!v.active) {
    for (const p of db.plans.filter((plan) => plan.status === "confirmed")) {
      for (const t of p.assignments) {
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
      }
    }
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

/**
 * Cancels all uncollected (assigned or accepted) trips across all confirmed plans.
 * Used by coordinators to free up unstarted reservations so donors can be re-planned.
 * @param {object} db - Database snapshot (mutated in place).
 * @param {string} userId - Authenticated coordinator user ID.
 * @param {{ revision: number }} input - Current revision number.
 * @throws {AppError} 400 if there are no uncollected reservations to release.
 */
export function releaseUnstarted(db, userId, input) {
  const u = actor(db, userId);
  manager(u);
  revision(db, input.revision);
  let count = 0;
  for (const p of db.plans.filter((plan) => plan.status === "confirmed")) {
    for (const t of p.assignments) {
      if (["assigned", "accepted"].includes(t.status)) {
        t.status = "cancelled";
        t.events.push({
          status: "cancelled",
          at: new Date().toISOString(),
          by: u.name,
        });
        count++;
      }
    }
  }
  requireThat(count > 0, "There are no uncollected reservations to release.");
  log(
    db,
    u,
    "Released uncollected reservations",
    `${count} trips; food in transit was preserved.`,
  );
}
