/**
 * @module demo-workspaces
 * Ephemeral, isolated demo workspace manager for the public RescueRoute instance.
 * Each public evaluator receives their own in-memory database clone so that
 * demo activity never touches the operator's local data file. Workspaces are
 * evicted automatically after a configurable TTL and the pool is capped to
 * prevent memory exhaustion on the shared hosting tier.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { Database, seedDatabase } from "./database.mjs";
import { LiveNetwork } from "./live-network.mjs";
import { AppError } from "./operations.mjs";

/**
 * Pool of ephemeral demo workspaces, each with its own {@link Database} and {@link LiveNetwork}.
 * Workspaces are identified by a random 32-byte hex token stored in a cookie.
 * Public evaluators get separate copies, never the local data file.
 */
export class DemoWorkspaces {
  /**
   * @param {{ max?: number, ttl?: number, now?: function(): number }} [options={}] - Pool configuration.
   * @param {number} [options.max=20] - Maximum concurrent demo workspaces.
   * @param {number} [options.ttl=3600000] - Workspace TTL in milliseconds (default 1 hour).
   * @param {function(): number} [options.now=Date.now] - Clock function for testability.
   */
  constructor({ max = 20, ttl = 3600000, now = Date.now } = {}) {
    this.entries = new Map();
    this.max = max;
    this.ttl = ttl;
    this.now = now;
    this.seed = seedDatabase();
    this.template = new Database({ initial: this.seed });
    this.timer = setInterval(() => this.prune(), 60000);
    this.timer.unref();
  }
  /**
   * Evicts workspaces that have been idle for longer than the TTL.
   * Called automatically every 60 seconds and before each `get()`.
   */
  prune() {
    for (const [id, workspace] of this.entries)
      if (this.now() - workspace.usedAt >= this.ttl) {
        workspace.live.close();
        this.entries.delete(id);
      }
  }
  /**
   * Looks up an existing workspace from the `rr_workspace` cookie, or creates one
   * when `create` is true. Returns null when no workspace exists and `create` is false.
   * Throws 503 when the pool is full and `create` is true.
   * @param {string} [cookie=""] - Raw HTTP `Cookie` header value.
   * @param {boolean} [create=false] - Whether to allocate a new workspace if none is found.
   * @returns {{ id: string, database: object, live: object, usedAt: number, intake: object }|null} The workspace, or null.
   * @throws {AppError} 503 if `create` is true but the pool is at maximum capacity.
   */
  get(cookie = "", create = false) {
    this.prune();
    const id = cookie
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("rr_workspace="))
      ?.slice("rr_workspace=".length);
    let workspace = this.entries.get(id);
    if (!workspace && create) {
      if (this.entries.size >= this.max)
        throw new AppError(
          503,
          "The public demo is at capacity. Please try again later.",
        );
      const initial = structuredClone(this.seed);
      initial.instanceId = randomUUID();
      const database = new Database({ initial });
      workspace = {
        id: randomBytes(32).toString("hex"),
        database,
        live: new LiveNetwork(database),
        usedAt: this.now(),
        intake: { busy: false, last: 0 },
      };
      this.entries.set(workspace.id, workspace);
    }
    if (workspace) workspace.usedAt = this.now();
    return workspace || null;
  }
  /**
   * Closes all live SSE connections, stops the pruning timer, and clears the pool.
   * Should be called on server shutdown to release all resources gracefully.
   */
  close() {
    clearInterval(this.timer);
    for (const w of this.entries.values()) w.live.close();
    this.entries.clear();
  }
}
