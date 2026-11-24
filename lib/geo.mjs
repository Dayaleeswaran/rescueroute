const R = 6371.0088;
const rad = (n) => (n * Math.PI) / 180;
// Existing fictional km-grid placements are displayed near Colombo. These are
// illustrative locations, never assertions about actual businesses/addresses.
export const DEMO_ORIGIN = [6.89, 79.85];
export function demoCoordinates(point) {
  return [
    DEMO_ORIGIN[0] + point[1] / 111.195,
    DEMO_ORIGIN[1] + point[0] / (111.195 * Math.cos(rad(DEMO_ORIGIN[0]))),
  ];
}
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
export const coordinates = (profile) =>
  profile.geo || demoCoordinates(profile.point);
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
