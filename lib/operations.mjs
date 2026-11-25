/**
 * @module operations
 * Business-logic facade for RescueRoute: entity CRUD, plan lifecycle (build →
 * confirm → trip transitions), user management, and role-based access control.
 * Re-exports cohesive sub-modules (`operations-shared`, `operations-entities`,
 * `operations-plans`, `operations-users`) so callers share a single entry point.
 * @see module:database
 * @see module:planner
 */
export {
  AppError,
  isManager,
  actor,
  manager,
  admin,
  log,
  quantities,
  availableScenario,
} from "./operations-shared.mjs";
export {
  saveEntity,
  reviewEntity,
  deleteEntity,
  withdrawEntity,
} from "./operations-entities.mjs";
export {
  buildDraft,
  confirmDraft,
  transitionTrip,
  cancelVolunteer,
  releaseUnstarted,
} from "./operations-plans.mjs";
export { saveUser, saveSettings, stateView } from "./operations-users.mjs";
