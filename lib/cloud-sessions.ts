import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db";
import { sessions } from "../db/schema";
import { CloudRequestError, validateSessionId, type CloudSession, type SessionCreate, type SessionPatch } from "./cloud-contract.mjs";

type SessionRow = typeof sessions.$inferSelect;

function publicSession(row: SessionRow): CloudSession {
  return {
    id: row.id,
    title: row.title,
    agent: row.agent,
    project: row.project,
    status: row.status,
    messages: row.messages,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// The owner predicate lives beside each query, including updates and deletes.
export async function listCloudSessions(ownerId: string): Promise<CloudSession[]> {
  const rows = await getDb().select().from(sessions).where(eq(sessions.ownerId, ownerId)).orderBy(desc(sessions.updatedAt)).limit(20);
  return rows.map(publicSession);
}

export async function getCloudSession(ownerId: string, id: string): Promise<CloudSession> {
  const [row] = await getDb().select().from(sessions).where(and(eq(sessions.id, validateSessionId(id)), eq(sessions.ownerId, ownerId))).limit(1);
  if (!row) throw new CloudRequestError("Session not found.", 404);
  return publicSession(row);
}

export async function createCloudSession(ownerId: string, payload: SessionCreate): Promise<CloudSession> {
  const timestamp = new Date().toISOString();
  const [row] = await getDb().insert(sessions).values({ ...payload, id: crypto.randomUUID(), ownerId, status: "idle", createdAt: timestamp, updatedAt: timestamp }).returning();
  return publicSession(row);
}

export async function updateCloudSession(ownerId: string, id: string, payload: SessionPatch): Promise<CloudSession> {
  const [row] = await getDb().update(sessions).set({ ...payload, updatedAt: new Date().toISOString() }).where(and(eq(sessions.id, validateSessionId(id)), eq(sessions.ownerId, ownerId))).returning();
  if (!row) throw new CloudRequestError("Session not found.", 404);
  return publicSession(row);
}

export async function deleteCloudSession(ownerId: string, id: string): Promise<void> {
  const [row] = await getDb().delete(sessions).where(and(eq(sessions.id, validateSessionId(id)), eq(sessions.ownerId, ownerId))).returning({ id: sessions.id });
  if (!row) throw new CloudRequestError("Session not found.", 404);
}

export async function cloudSessionStats(ownerId: string) {
  const [row] = await getDb().select({ total: sql<number>`count(*)`, running: sql<number>`coalesce(sum(case when ${sessions.status} = 'running' then 1 else 0 end), 0)` }).from(sessions).where(eq(sessions.ownerId, ownerId));
  return { total: Number(row.total), running: Number(row.running) };
}

export async function checkCloudDatabase(): Promise<void> {
  // Probe the migration-owned table rather than claiming a binding is healthy.
  await getDb().select({ id: sessions.id }).from(sessions).limit(0);
}
