/**
 * @module geo
 * Geographic utilities for RescueRoute: coordinate conversion, distance calculation,
 * and demo-grid helpers. Demo coordinates are illustrative placements near Colombo —
 * they are never assertions about real businesses or addresses.
 */
const R = 6371.0088;
const rad = (n) => (n * Math.PI) / 180;
// Existing fictional km-grid placements are displayed near Colombo. These are
// illustrative locations, never assertions about actual businesses/addresses.
/** Reference origin [lat, lon] used to anchor the fictional km-grid demo scenario near Colombo. */
export const DEMO_ORIGIN = [6.89, 79.85];

/**
 * Converts a fictional km-grid `[x, y]` point to `[lat, lon]` coordinates
 * anchored at {@link DEMO_ORIGIN}. Used for demo display only.
 * @param {[number, number]} point - Grid point in kilometres [x, y].
 * @returns {[number, number]} Geographic coordinates [latitude, longitude].
 */
export function demoCoordinates(point) {
  return [
    DEMO_ORIGIN[0] + point[1] / 111.195,
    DEMO_ORIGIN[1] + point[0] / (111.195 * Math.cos(rad(DEMO_ORIGIN[0]))),
  ];
}
/**
 * Returns true when `p` is a valid `[lat, lon]` coordinate pair within
 * the supported geographic bounds (lat ±85°, lon ±180°).
 * @param {unknown} p - Value to validate.
 * @returns {boolean} True if `p` is a valid coordinate pair.
 */
export function validCoordinates(p) {
  return (
    Array.isArray(p) &&
    p.length === 2 &&
    Number.isFinite(p[0]) &&
    Number.isFinite(p[1]) &&
    p[0] >= -85 &&
    p[0] <= 85 &&
    p[1] >= -180 &&
    p[1] <= 180
  );
}
/**
 * Extracts the effective `[lat, lon]` coordinates from a profile record.
 * Uses `profile.geo` if present (real geographic coordinates), otherwise
 * converts the fictional `profile.point` km-grid location via {@link demoCoordinates}.
 * @param {{ geo?: [number, number], point: [number, number] }} profile - A donor, recipient, or volunteer profile.
 * @returns {[number, number]} Geographic coordinates [latitude, longitude].
 */
export const coordinates = (profile) =>
  profile.geo || demoCoordinates(profile.point);

/**
 * Computes the great-circle distance in kilometres between two `[lat, lon]` points
 * using the Haversine formula.
 * @param {[number, number]} a - First coordinate [latitude, longitude].
 * @param {[number, number]} b - Second coordinate [latitude, longitude].
 * @returns {number} Distance in kilometres.
 */
export function geographicDistance(a, b) {
  const h =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) *
      Math.cos(rad(b[0])) *
      Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return (
    R * 2 * Math.atan2(Math.sqrt(Math.min(1, h)), Math.sqrt(Math.max(0, 1 - h)))
  );
}
