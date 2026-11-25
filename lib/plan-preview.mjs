import { availableScenario, actor, manager, AppError } from "./operations.mjs";
import { planRescue, auditPlan } from "./planner.mjs";

// Compare only future, unreserved work. Existing commitments are never cancelled.
export function previewPlan(db, userId, input = {}) {
  manager(actor(db, userId));
  if (input.revision !== db.revision)
    throw new AppError(
      409,
      "The network changed. Refresh before comparing plans.",
    );
  if (
    typeof input.volunteerId !== "string" ||
    !db.volunteers.some((v) => v.id === input.volunteerId && v.active)
  )
    throw new AppError(
      400,
      "Choose an active volunteer to exclude from this preview.",
    );
  const baseline = availableScenario(db);
  const changed = structuredClone(baseline);
  changed.volunteers = changed.volunteers.map((v) =>
    v.id === input.volunteerId ? { ...v, active: false } : v,
  );
  const summarise = (scenario) => {
    const result = planRescue(scenario);
    if (auditPlan(scenario, result).length)
      throw new AppError(
        500,
        "The comparison failed its independent feasibility audit.",
      );
    return {
      metrics: result.metrics,
      unallocated: result.unallocated.map((row) => ({
        ...row,
        name: scenario.offers.find((o) => o.id === row.offerId).name,
      })),
      unmet: result.unmet.map((row) => ({
        ...row,
        name: scenario.requests.find((r) => r.id === row.requestId).name,
      })),
    };
  };
  const before = summarise(baseline),
    after = summarise(changed);
  return {
    revision: db.revision,
    volunteer: {
      id: input.volunteerId,
      name: db.volunteers.find((v) => v.id === input.volunteerId).name,
    },
    baseline: before,
    alternative: after,
    difference: after.metrics.allocated - before.metrics.allocated,
    notice:
      "Preview only: no records, reservations, availability, or deliveries were changed. Existing committed trips remain in place. This compares future unreserved work using a heuristic, not a global optimum.",
  };
}
