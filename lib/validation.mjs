export class InputError extends Error {}
const assert = (ok, message) => {
  if (!ok) throw new InputError(message);
};
const number = (value, min, max, label) =>
  assert(
    Number.isFinite(value) && value >= min && value <= max,
    `${label} must be between ${min} and ${max}.`,
  );
const integer = (value, min, max, label) => {
  number(value, min, max, label);
  assert(Number.isInteger(value), `${label} must be a whole number.`);
};
const text = (value, label) =>
  assert(
    typeof value === "string" && value.trim().length > 0 && value.length <= 120,
    `${label} must contain 1–120 characters.`,
  );
const strings = (value, label) => {
  assert(
    Array.isArray(value) && value.length <= 16,
    `${label} must be a short list.`,
  );
  value.forEach((v) => text(v, label));
};
export function validateScenario(s) {
  assert(s && typeof s === "object", "A scenario is required.");
  integer(s.now, 0, 1439, "Start time");
  for (const kind of ["offers", "requests", "volunteers"]) {
    assert(
      Array.isArray(s[kind]) && s[kind].length <= 30,
      `${kind} must contain at most 30 entries.`,
    );
    const ids = new Set();
    for (const item of s[kind]) {
      assert(item && typeof item === "object", "Each entry must be an object.");
      text(item.id, "ID");
      text(item.name, "Name");
      assert(!ids.has(item.id), "Duplicate IDs are not allowed.");
      ids.add(item.id);
      assert(
        Array.isArray(item.point) && item.point.length === 2,
        "A grid location is required.",
      );
      if (s.coordinateSystem === "geo") {
        number(item.point[0], -85, 85, "Latitude");
        number(item.point[1], -180, 180, "Longitude");
      } else item.point.forEach((v) => number(v, 0, 12, "Location"));
      if (kind === "volunteers") {
        integer(item.capacity, 1, 500, "Capacity");
        integer(item.available, 0, 1439, "Availability");
        integer(item.until, item.available, 1439, "Shift end");
        assert(
          typeof item.active === "boolean" && typeof item.chilled === "boolean",
          "Volunteer status and chilled capability are required.",
        );
      } else {
        integer(item.meals, 1, 1000, "Meals");
        integer(item.deadline, 0, 1439, "Deadline");
        if (kind === "offers") {
          text(item.food, "Food");
          integer(item.ready, 0, item.deadline, "Ready time");
          if (item.deliverBy !== undefined)
            integer(
              item.deliverBy,
              item.deadline,
              1439,
              "Food delivery deadline",
            );
          if (item.maxTransitMinutes !== undefined)
            integer(item.maxTransitMinutes, 1, 240, "Maximum transit time");
          strings(item.allergens, "Allergens");
          assert(
            ["ambient", "chilled"].includes(item.handling),
            "Handling must be ambient or chilled.",
          );
          assert(
            typeof item.verified === "boolean",
            "Offer verification is required.",
          );
        } else {
          strings(item.excludes, "Excluded allergens");
          integer(item.priority, 1, 3, "Priority");
        }
      }
    }
  }
  return s;
}
