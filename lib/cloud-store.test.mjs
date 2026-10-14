import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { drizzle } from "drizzle-orm/d1";
import ts from "typescript";

const asModule = (value) => `data:text/javascript;base64,${Buffer.from(value).toString("base64")}`;
const compile = async (path) => ts.transpileModule(await readFile(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const schemaModule = asModule((await compile("../db/schema.ts")).replace('"drizzle-orm/sqlite-core"', JSON.stringify(import.meta.resolve("drizzle-orm/sqlite-core"))));
const schema = await import(schemaModule);
const contractModule = asModule(await compile("./cloud-contract.mts"));

// Run the real Drizzle queries against SQLite, adapting only the Cloudflare D1
// transport. This catches missing owner predicates on reads, writes, and stats.
const sqlite = new DatabaseSync(":memory:");
for (const filename of (await readdir(new URL("../drizzle/", import.meta.url))).filter((file) => file.endsWith(".sql")).sort()) {
  sqlite.exec(await readFile(new URL(`../drizzle/${filename}`, import.meta.url), "utf8"));
}
const client = {
  prepare(query) {
    const statement = sqlite.prepare(query);
    let params = [];
    return {
      bind(...values) { params = values; return this; },
      async raw() { statement.setReturnArrays(true); return statement.all(...params); },
      async all() { statement.setReturnArrays(false); return { success: true, results: statement.all(...params) }; },
      async run() { return { success: true, results: [], meta: statement.run(...params) }; },
    };
  },
};
globalThis.__closedcodeTestDb = drizzle(client, { schema });
const dbModule = asModule("export function getDb() { return globalThis.__closedcodeTestDb; }");
const storeCode = (await compile("./cloud-sessions.ts"))
  .replace('"drizzle-orm"', JSON.stringify(import.meta.resolve("drizzle-orm")))
  .replace('"../db"', JSON.stringify(dbModule))
  .replace('"../db/schema"', JSON.stringify(schemaModule))
  .replace('"./cloud-contract.mjs"', JSON.stringify(contractModule));
const store = await import(asModule(storeCode));
const createPayload = { title: "Fix failing build", agent: "atlas", project: "closedcode", messages: [] };

beforeEach(() => sqlite.exec("DELETE FROM sessions"));
after(() => { sqlite.close(); delete globalThis.__closedcodeTestDb; });

test("saved sessions round-trip with messages and never expose owner IDs", async () => {
  const message = { id: "one", role: "user", content: "Fix this parser", createdAt: "2026-10-14T10:00:00.000Z" };
  const created = await store.createCloudSession("alice", { ...createPayload, messages: [message] });
  assert.equal(created.status, "idle");
  assert.match(created.id, /^[a-f0-9-]{36}$/);
  assert.equal("ownerId" in created, false);
  assert.deepEqual(await store.getCloudSession("alice", created.id), created);
  assert.deepEqual((await store.listCloudSessions("alice"))[0].messages, [message]);
});

test("one owner cannot discover, read, update, or delete another owner's session", async () => {
  const created = await store.createCloudSession("alice", createPayload);
  assert.deepEqual(await store.listCloudSessions("bob"), []);
  for (const action of [
    () => store.getCloudSession("bob", created.id),
    () => store.updateCloudSession("bob", created.id, { title: "Hijacked" }),
    () => store.deleteCloudSession("bob", created.id),
  ]) await assert.rejects(action(), (error) => error.status === 404 && error.message === "Session not found.");
  assert.equal((await store.getCloudSession("alice", created.id)).title, createPayload.title);
});

test("updates, running counts, and deletion stay scoped to the owning account", async () => {
  const alice = await store.createCloudSession("alice", createPayload);
  const bob = await store.createCloudSession("bob", createPayload);
  await store.updateCloudSession("alice", alice.id, { status: "running", title: "Parser repair" });
  await store.updateCloudSession("bob", bob.id, { status: "complete" });
  assert.deepEqual(await store.cloudSessionStats("alice"), { total: 1, running: 1 });
  assert.deepEqual(await store.cloudSessionStats("bob"), { total: 1, running: 0 });
  assert.deepEqual(await store.cloudSessionStats("unknown"), { total: 0, running: 0 });
  await store.deleteCloudSession("alice", alice.id);
  assert.deepEqual(await store.cloudSessionStats("alice"), { total: 0, running: 0 });
  assert.equal((await store.getCloudSession("bob", bob.id)).status, "complete");
});

test("database readiness actually probes the migrated sessions table", async () => {
  await store.checkCloudDatabase();
});
