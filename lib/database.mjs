/**
 * @module database
 * Persistent, serialised JSON database and seed factory for RescueRoute.
 * The {@link Database} class serialises all mutations through a promise queue
 * to prevent concurrent write races. Data is written atomically by renaming
 * a temporary file, so a crash during a write never corrupts stored records.
 * The {@link seedDatabase} function populates a fresh database with fictional
 * Harbor City demo data for onboarding and evaluation purposes.
 */
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import { writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createScenario } from "./scenario.mjs";
import { DEMO_PASSWORD, hashPassword } from "./auth.mjs";

/**
 * Builds and returns a complete seeded database state for the Harbor City demo.
 * Creates donors, recipients, volunteer accounts, users, an empty plan log, and
 * an audit trail entry. All coordinates are fictional and near Colombo.
 * @returns {object} A complete RescueRoute database object at schema version 2.
 */
export function seedDatabase() {
  const s = createScenario();
  const donorNames = ["green", "bakery", "roots"];
  const donors = s.offers.map((o, i) => ({
    id: `d${i + 1}`,
    name: o.name,
    point: o.point,
    contact: `${donorNames[i]}@demo.rescueroute.test`,
    active: true,
  }));
  const recipients = s.requests.map((r, i) => ({
    id: `n${i + 1}`,
    name: r.name,
    point: r.point,
    contact: `${i ? "riverside" : "northside"}@demo.rescueroute.test`,
    active: true,
  }));
  const accounts = [
    ["admin", "Jamie Davis", "admin", null],
    ["coordinator", "Sam Rivera", "coordinator", null],
    ["donor", donors[0].name, "donor", "d1"],
    ["bakery", donors[1].name, "donor", "d2"],
    ["roots", donors[2].name, "donor", "d3"],
    ["recipient", recipients[0].name, "recipient", "n1"],
    ["riverside", recipients[1].name, "recipient", "n2"],
    ["volunteer", "Maya Chen", "volunteer", "v1"],
    ["alex", "Alex Morgan", "volunteer", "v2"],
  ];
  return {
    schema: 2,
    instanceId: randomUUID(),
    revision: 1,
    settings: {
      networkName: "Harbor City Network",
      city: "Harbor City",
      serviceDate: "2026-11-25",
      now: s.now,
    },
    donors,
    recipients,
    offers: s.offers.map((o, i) => ({
      ...o,
      donorId: donors[i].id,
      status: "approved",
      donorConfirmed: true,
      deliverBy: 1080,
      maxTransitMinutes: 60,
      notes: "Seeded fictional offer",
      createdAt: new Date().toISOString(),
    })),
    requests: s.requests.map((r, i) => ({
      ...r,
      recipientId: recipients[i].id,
      status: "approved",
      notes: "",
      createdAt: new Date().toISOString(),
    })),
    volunteers: s.volunteers.map((v) => ({
      ...v,
      contact: `${v.id}@demo.rescueroute.test`,
    })),
    users: accounts.map(([account, name, role, entityId], i) => ({
      id: `u${i + 1}`,
      name,
      email: `${account}@demo.rescueroute.test`,
      role,
      entityId,
      active: true,
      passwordHash: hashPassword(DEMO_PASSWORD),
    })),
    plans: [],
    notifications: [],
    audit: [
      {
        id: randomUUID(),
        at: new Date().toISOString(),
        actor: "System",
        action: "Demo network initialised",
        detail: "Fictional records; no real deliveries.",
      },
    ],
  };
}

/** Serialises transactions and replaces the data file only after a complete write. */
export class Database {
  constructor({ directory = null, initial } = {}) {
    this.listeners = new Set();
    this.directory = directory;
    this.queue = Promise.resolve();
    if (directory) mkdirSync(directory, { recursive: true });
    const file = directory && join(directory, "rescueroute.json");
    this.data =
      file && existsSync(file)
        ? JSON.parse(readFileSync(file, "utf8"))
        : initial || seedDatabase();
    if (
      this.data.schema !== 2 ||
      !Array.isArray(this.data.users) ||
      !Number.isInteger(this.data.revision)
    )
      throw new Error(
        "Unsupported or invalid RescueRoute data file. Restore a valid backup; data was not reset.",
      );
  }
  /**
   * Returns a deep clone of the current database state.
   * @returns {object} Full database snapshot.
   */
  read() {
    return structuredClone(this.data);
  }
  /**
   * Runs `change` inside a serialised transaction, writes the result to disk
   * atomically (temp-file rename), increments `revision`, and notifies subscribers.
   * @template T
   * @param {function(object): T} change - Mutation function that receives the current DB state and may return a result.
   * @returns {Promise<T|null>} Resolves to the value returned by `change`, or null.
   */
  transaction(change) {
    const operation = this.queue.then(async () => {
      const next = this.read();
      const result = change(next);
      next.revision++;
      if (this.directory) {
        const tmp = join(this.directory, `.write-${randomUUID()}.tmp`);
        try {
          await writeFile(tmp, JSON.stringify(next, null, 2), {
            encoding: "utf8",
            mode: 0o600,
          });
          await rename(tmp, join(this.directory, "rescueroute.json"));
        } catch (e) {
          await unlink(tmp).catch(() => {});
          throw e;
        }
      }
      this.data = next;
      for (const listener of this.listeners) {
        try {
          listener(next.revision);
        } catch {
          /* A disconnected subscriber must not roll back committed data. */
        }
      }
      return structuredClone(result ?? null);
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
  /**
   * Writes the initial data file to disk if the directory is configured and
   * the file does not yet exist. Safe to call at startup.
   * @returns {Promise<void>}
   */
  async initialise() {
    if (this.directory && !existsSync(join(this.directory, "rescueroute.json")))
      await this.transaction(() => {});
  }
  /**
   * Registers a listener that is called with the new revision number after each
   * committed transaction. Returns an unsubscribe function.
   * @param {function(number): void} listener - Called with the new revision after each write.
   * @returns {function(): void} Unsubscribe function that removes the listener.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
