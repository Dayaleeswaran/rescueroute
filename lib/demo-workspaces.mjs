import { randomBytes, randomUUID } from "node:crypto";
import { Database, seedDatabase } from "./database.mjs";
import { LiveNetwork } from "./live-network.mjs";
import { AppError } from "./operations.mjs";

/** Public evaluators get separate ephemeral copies, never the local data file. */
export class DemoWorkspaces {
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
  prune() {
    for (const [id, workspace] of this.entries)
      if (this.now() - workspace.usedAt >= this.ttl) {
        workspace.live.close();
        this.entries.delete(id);
      }
  }
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
  close() {
    clearInterval(this.timer);
    for (const w of this.entries.values()) w.live.close();
    this.entries.clear();
  }
}
