import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Database, seedDatabase } from "../lib/database.mjs";
import { LiveNetwork } from "../lib/live-network.mjs";

const initial = seedDatabase();
class Response extends EventEmitter {
  destroyed = false;
  writableEnded = false;
  writes = [];
  blocked = false;
  broken = false;
  writeHead() {}
  write(message) {
    if (this.broken) throw Error("Socket disconnected.");
    this.writes.push(message);
    return !this.blocked;
  }
  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
  end() {
    this.writableEnded = true;
    this.emit("close");
  }
}
const fixture = (t) => {
  const live = new LiveNetwork(
    new Database({ initial: structuredClone(initial) }),
  );
  t.after(() => live.close());
  return live;
};
test("SSE immediately disconnects a client whose first write hits backpressure", (t) => {
  const live = fixture(t),
    response = new Response();
  response.blocked = true;
  live.connect({}, response, () => true);
  assert.equal(response.destroyed, true);
  assert.equal(live.clients.size, 0);
});
test("slow event consumers are dropped while healthy clients keep receiving updates", (t) => {
  const live = fixture(t),
    slow = new Response(),
    healthy = new Response();
  live.connect({}, slow, () => true);
  live.connect({}, healthy, () => true);
  slow.blocked = true;
  live.broadcast("network", { revision: 2 });
  live.broadcast("network", { revision: 3 });
  assert.equal(slow.destroyed, true);
  assert.equal(slow.writes.length, 2);
  assert.equal(healthy.writes.length, 3);
  assert.equal(live.clients.size, 1);
});
test("broken sockets and revoked sessions cannot interrupt other SSE recipients", (t) => {
  const live = fixture(t),
    broken = new Response(),
    revoked = new Response(),
    healthy = new Response();
  live.connect({}, broken, () => true);
  live.connect({}, revoked, () => false);
  live.connect({}, healthy, () => true);
  broken.broken = true;
  assert.doesNotThrow(() => live.broadcast("network", { revision: 2 }));
  assert.equal(broken.destroyed, true);
  assert.equal(revoked.writableEnded, true);
  assert.match(revoked.writes.at(-1), /session-expired/);
  assert.equal(live.clients.size, 1);
  assert.match(healthy.writes.at(-1), /revision/);
});
