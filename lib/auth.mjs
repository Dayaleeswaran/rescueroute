import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const DEMO_PASSWORD = "RescueDemo!2026";
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password, encoded) {
  if (
    typeof password !== "string" ||
    password.length > 128 ||
    typeof encoded !== "string"
  )
    return false;
  const [salt, hash] = encoded.split(":");
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64),
    expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export const publicUser = ({ id, name, email, role, entityId, active }) => ({
  id,
  name,
  email,
  role,
  entityId,
  active,
});
export class Sessions {
  constructor() {
    this.entries = new Map();
  }
  create(userId, authVersion = 0, instanceId = "") {
    const token = randomBytes(32).toString("hex");
    const session = {
      userId,
      authVersion,
      instanceId,
      csrf: randomBytes(24).toString("hex"),
      expires: Date.now() + 8 * 3600000,
    };
    for (const [id, item] of this.entries)
      if (item.expires <= Date.now()) this.entries.delete(id);
    if (this.entries.size >= 200)
      this.entries.delete(this.entries.keys().next().value);
    this.entries.set(token, session);
    return { token, ...session };
  }
  get(cookie = "") {
    const token = cookie
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("rr_session="))
      ?.slice(11);
    const s = this.entries.get(token);
    if (!s || s.expires <= Date.now()) {
      this.entries.delete(token);
      return null;
    }
    return { ...s, token };
  }
  delete(token) {
    this.entries.delete(token);
  }
  clear() {
    this.entries.clear();
  }
  removeInstance(instanceId) {
    for (const [token, s] of this.entries)
      if (s.instanceId === instanceId) this.entries.delete(token);
  }
}
