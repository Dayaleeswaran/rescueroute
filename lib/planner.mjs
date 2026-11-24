import { validateScenario } from "./validation.mjs";
import { hasAllergenConflict } from "./allergens.mjs";
import { geographicDistance } from "./geo.mjs";

export const distance = (a, b, geographic = false) =>
  geographic ? geographicDistance(a, b) : Math.hypot(a[0] - b[0], a[1] - b[1]);
export const travelMinutes = (a, b, geographic = false) =>
  Math.ceil(distance(a, b, geographic) / 0.4); // Assumed 24 km/h.
export const clock = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const SERVICE = 4;

function candidate(s, offer, request, volunteer, state, left, needed) {
  if (!offer.verified || left <= 0 || needed <= 0 || !volunteer.active)
    return null;
  if (hasAllergenConflict(offer.allergens, request.excludes)) return null;
  if (offer.handling === "chilled" && !volunteer.chilled) return null;
  const pickup = Math.max(
    state.time +
      travelMinutes(state.point, offer.point, s.coordinateSystem === "geo"),
    offer.ready,
  );
  const delivery =
    pickup +
    SERVICE +
    travelMinutes(offer.point, request.point, s.coordinateSystem === "geo") +
    SERVICE;
  if (
    pickup + SERVICE > offer.deadline ||
    delivery > (offer.deliverBy ?? 1439) ||
    delivery - pickup - SERVICE > (offer.maxTransitMinutes ?? 1440) ||
    delivery > request.deadline ||
    delivery > volunteer.until
  )
    return null;
  const meals = Math.min(left, needed, volunteer.capacity);
  const km =
    distance(state.point, offer.point, s.coordinateSystem === "geo") +
    distance(offer.point, request.point, s.coordinateSystem === "geo");
  // Heuristic: prioritize soon-closing supply, then urgent requests, fuller loads, shorter trips.
  // Urgency is relative to the common planning start, never to a driver's arrival:
  // using arrival would perversely reward a later pickup. Preserve scarce chilled vehicles.
  const chilledOpportunityCost =
    volunteer.chilled &&
    offer.handling !== "chilled" &&
    s.offers.some((o) => o.verified && o.handling === "chilled")
      ? 15
      : 0;
  const score =
    1200 / (Math.max(0, offer.deadline - s.now) + 10) +
    request.priority * 9 +
    meals * 0.7 -
    km * 0.8 -
    chilledOpportunityCost;
  return {
    offerId: offer.id,
    requestId: request.id,
    volunteerId: volunteer.id,
    meals,
    pickup,
    delivery,
    km,
    from: [...state.point],
    score,
  };
}

export function planRescue(scenario) {
  const s = validateScenario(scenario);
  const stock = new Map(s.offers.map((o) => [o.id, o.meals]));
  const demand = new Map(s.requests.map((r) => [r.id, r.meals]));
  const states = new Map(
    s.volunteers.map((v) => [
      v.id,
      { time: Math.max(s.now, v.available), point: v.point },
    ]),
  );
  const assignments = [];
  // Each trip exhausts either an offer, a request, or a vehicle-sized batch.
  // The cap keeps worst-case work bounded even for untrusted input.
  for (let iteration = 0; iteration < 240; iteration++) {
    let best = null;
    for (const o of s.offers)
      for (const r of s.requests)
        for (const v of s.volunteers) {
          const c = candidate(
            s,
            o,
            r,
            v,
            states.get(v.id),
            stock.get(o.id),
            demand.get(r.id),
          );
          if (c && (!best || c.score > best.score)) best = c;
        }
    if (!best) break;
    const o = s.offers.find((o) => o.id === best.offerId);
    const r = s.requests.find((r) => r.id === best.requestId);
    assignments.push({
      ...best,
      id: `trip-${assignments.length + 1}`,
      reason: `${o.name} closes at ${clock(o.deadline)}. ${r.name} accepts the declared allergens${o.handling === "chilled" ? "; this vehicle supports chilled handling" : ""}. Collection and delivery fit both time windows.`,
    });
    stock.set(o.id, stock.get(o.id) - best.meals);
    demand.set(r.id, demand.get(r.id) - best.meals);
    states.set(best.volunteerId, { time: best.delivery, point: r.point });
  }
  const unallocated = s.offers
    .filter((o) => stock.get(o.id) > 0)
    .map((o) => {
      const pending = s.requests.filter((r) => demand.get(r.id) > 0);
      let reason;
      if (!o.verified)
        reason =
          "Awaiting donor confirmation of food suitability and handling details.";
      else if (!pending.length)
        reason = "All current recipient demand is covered.";
      else if (!s.volunteers.some((v) => v.active))
        reason = "No volunteers are available.";
      else if (
        pending.every((r) => hasAllergenConflict(o.allergens, r.excludes))
      )
        reason = "Remaining recipients exclude a declared allergen.";
      else if (
        o.handling === "chilled" &&
        !s.volunteers.some((v) => v.active && v.chilled)
      )
        reason = "No active volunteer has chilled transport.";
      else
        reason =
          "No remaining trip fits the collection, delivery, and volunteer time windows under this plan.";
      return { offerId: o.id, meals: stock.get(o.id), reason };
    });
  const allocated = assignments.reduce((n, a) => n + a.meals, 0);
  return {
    assignments,
    unallocated,
    unmet: s.requests
      .map((r) => ({ requestId: r.id, meals: demand.get(r.id) }))
      .filter((r) => r.meals > 0),
    metrics: {
      allocated,
      offered: s.offers.reduce((n, o) => n + o.meals, 0),
      requested: s.requests.reduce((n, r) => n + r.meals, 0),
      km: Math.round(assignments.reduce((n, a) => n + a.km, 0) * 10) / 10,
      trips: assignments.length,
    },
  };
}

// Independent feasibility check: never trust a proposed allocation, including AI output.
export function auditPlan(s, plan) {
  validateScenario(s);
  const errors = [];
  const stock = new Map(s.offers.map((o) => [o.id, o.meals]));
  const demand = new Map(s.requests.map((r) => [r.id, r.meals]));
  const states = new Map(
    s.volunteers.map((v) => [
      v.id,
      { point: v.point, time: Math.max(s.now, v.available) },
    ]),
  );
  for (const a of plan.assignments) {
    const o = s.offers.find((o) => o.id === a.offerId),
      r = s.requests.find((r) => r.id === a.requestId),
      v = s.volunteers.find((v) => v.id === a.volunteerId);
    if (!o || !r || !v) {
      errors.push("Unknown assignment reference.");
      continue;
    }
    // Deliberately check constraints directly rather than reuse the candidate scorer.
    const previous = states.get(v.id);
    const earliestPickup = Math.max(
      previous.time +
        travelMinutes(previous.point, o.point, s.coordinateSystem === "geo"),
      o.ready,
    );
    const earliestDelivery =
      a.pickup +
      SERVICE +
      travelMinutes(o.point, r.point, s.coordinateSystem === "geo") +
      SERVICE;
    const conflict = hasAllergenConflict(o.allergens, r.excludes);
    if (
      !v.active ||
      !o.verified ||
      conflict ||
      (o.handling === "chilled" && !v.chilled) ||
      !Number.isInteger(a.meals) ||
      a.meals <= 0 ||
      a.meals > v.capacity ||
      a.meals > stock.get(o.id) ||
      a.meals > demand.get(r.id) ||
      !Number.isInteger(a.pickup) ||
      !Number.isInteger(a.delivery) ||
      a.pickup < earliestPickup ||
      a.pickup + SERVICE > o.deadline ||
      a.delivery < earliestDelivery ||
      a.delivery > (o.deliverBy ?? 1439) ||
      a.delivery - a.pickup - SERVICE > (o.maxTransitMinutes ?? 1440) ||
      a.delivery > r.deadline ||
      a.delivery > v.until
    )
      errors.push(`Invalid assignment ${a.id}.`);
    stock.set(o.id, stock.get(o.id) - a.meals);
    demand.set(r.id, demand.get(r.id) - a.meals);
    states.set(v.id, { point: r.point, time: a.delivery });
  }
  return errors;
}
