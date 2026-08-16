import { desc, eq, ilike, kbArticles, or, sql, type KbArticle } from "@repo/db";
import { db } from "../db.js";

export const knowledgeRepository = {
  // Weighted ILIKE: title beats keywords beats body.
  async search(query: string, limit = 4): Promise<KbArticle[]> {
    const term = `%${query}%`;
    return db
      .select()
      .from(kbArticles)
      .where(
        or(
          ilike(kbArticles.title, term),
          ilike(kbArticles.keywords, term),
          ilike(kbArticles.body, term),
        ),
      )
      .orderBy(
        desc(sql`
          (case when ${kbArticles.title} ilike ${term} then 3 else 0 end) +
          (case when ${kbArticles.keywords} ilike ${term} then 2 else 0 end) +
          (case when ${kbArticles.body} ilike ${term} then 1 else 0 end)
        `),
      )
      .limit(limit);
  },

  async findBySlug(slug: string): Promise<KbArticle | null> {
    const [row] = await db.select().from(kbArticles).where(eq(kbArticles.slug, slug)).limit(1);
    return row ?? null;
  },

  async listCategories(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ category: kbArticles.category })
      .from(kbArticles)
      .orderBy(kbArticles.category);
    return rows.map((r) => r.category);
  },
};
