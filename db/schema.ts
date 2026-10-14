import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { CloudMessage, CloudSessionStatus } from "../lib/cloud-contract.mjs";

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id").notNull(),
    title: text("title").notNull(),
    agent: text("agent").notNull(),
    project: text("project").notNull(),
    status: text("status", { enum: ["idle", "running", "complete"] })
      .$type<CloudSessionStatus>()
      .notNull()
      .default("idle"),
    messages: text("messages", { mode: "json" })
      .$type<CloudMessage[]>()
      .notNull()
      .default([]),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("sessions_owner_updated_idx").on(table.ownerId, table.updatedAt)],
);
