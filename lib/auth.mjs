/**
 * @module auth
 * Authentication utilities: password hashing, constant-time verification,
 * public user projection, and an in-process session store for RescueRoute.
 * Passwords are hashed with scrypt (salt:hash). Sessions expire after 8 hours
 * and are stored in memory — they are not persisted across restarts.
 */
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/** Shared demo password used in seeded accounts. */
export const DEMO_PASSWORD = "RescueDemo!2026";

/**
 * Hashes a plaintext password using scrypt with a random 16-byte salt.
 * @param {string} password - The plaintext password to hash.
 * @returns {string} A `salt:hash` encoded string suitable for storage.
 */
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
/**
 * Verifies a plaintext password against a stored `salt:hash` string.
 * Uses constant-time comparison to prevent timing attacks.
 * @param {string} password - The plaintext password to verify.
 * @param {string} encoded - The stored `salt:hash` string from {@link hashPassword}.
 * @returns {boolean} True if the password matches, false otherwise.
 */
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
/**
 * Returns a safe public projection of a user record, omitting sensitive fields
 * such as password hashes and internal metadata.
 * @param {{ id: string, name: string, email: string, role: string, entityId: string|null, active: boolean }} user - Full user record.
 * @returns {{ id: string, name: string, email: string, role: string, entityId: string|null, active: boolean }} Public-safe user object.
 */
export const publicUser = ({ id, name, email, role, entityId, active }) => ({
  id,
  name,
  email,
  role,
  entityId,
  active,
});
/**
 * In-memory session store for RescueRoute.
 * Sessions are keyed by a 32-byte random hex token stored in an HttpOnly cookie.
 * Expired sessions are pruned on each `create` call; the store is capped at 200
 * active sessions to prevent unbounded memory growth.
 */
export class Sessions {
  constructor() {
    this.entries = new Map();
  }

  /**
   * Creates a new session for the given user and returns the session token.
   * @param {string} userId - The authenticated user's ID.
   * @param {number} [authVersion=0] - The user's current auth version for invalidation.
   * @param {string} [instanceId=""] - Optional demo-workspace instance identifier.
   * @returns {{ token: string, userId: string, authVersion: number, instanceId: string, csrf: string, expires: number }} Session object including the token.
   */
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
  /**
   * Looks up an active session from an HTTP `Cookie` header string.
   * Returns null if the session is missing or expired.
   * @param {string} [cookie=""] - The raw HTTP `Cookie` header value.
   * @returns {{ token: string, userId: string, authVersion: number, instanceId: string, csrf: string, expires: number } | null} The session, or null if not found/expired.
   */
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
  /**
   * Deletes a session by its token, logging the user out of this device.
   * @param {string} token - The session token to invalidate.
   */
  delete(token) {
    this.entries.delete(token);
  }
  /**
   * Clears all sessions from the store (used in tests and demo resets).
   */
  clear() {
    this.entries.clear();
  }
  /**
   * Removes all sessions associated with a specific demo workspace instance.
   * @param {string} instanceId - The demo instance ID whose sessions should be removed.
   */
  removeInstance(instanceId) {
    for (const [token, s] of this.entries)
      if (s.instanceId === instanceId) this.entries.delete(token);
  }
}
