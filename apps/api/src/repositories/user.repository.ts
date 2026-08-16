import { asc, eq, users, type User } from "@repo/db";
import { db } from "../db.js";

export const userRepository = {
  async findById(id: string): Promise<User | null> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  },

  async findByEmail(email: string): Promise<User | null> {
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    return row ?? null;
  },

  // No auth in this build, so "current user" is the first seeded customer.
  async findDemoUser(): Promise<User | null> {
    const [row] = await db.select().from(users).orderBy(asc(users.createdAt)).limit(1);
    return row ?? null;
  },
};
