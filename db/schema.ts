import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

// A project is a workspace for one agent team: its name, icon and the office its agents work in.
export const projects = pgTable("projects", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  // Preset icon id (see lib/project-icons.ts); used when iconFile is null
  icon: text("icon"),
  // Uploaded icon, stored under .uploads/project-icons/<iconFile>
  iconFile: text("icon_file"),
  // Office scene id: office-studio/<officeId>.json
  officeId: text("office_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
