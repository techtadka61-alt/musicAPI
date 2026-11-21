import type { Model } from 'mongoose';
import type { Category } from '../modules/categories/schemas/category.schema';

export const SEED_CATEGORIES = [
  { slug: 'hindi', name: 'Hindi', description: 'Bollywood shaadi songs', sortOrder: 1 },
  { slug: 'bhojpuri', name: 'Bhojpuri', description: 'Bhojpuri shaadi songs', sortOrder: 2 },
  { slug: 'punjabi', name: 'Punjabi', description: 'Punjabi shaadi songs', sortOrder: 3 },
] as const;

export interface SeedResult {
  created: string[];
  existing: string[];
}

/**
 * Inserts the initial categories. Idempotent and non-destructive: an existing category is
 * never overwritten, so later edits in the database survive re-running the seed.
 */
export async function seedCategories(categoryModel: Model<Category>): Promise<SeedResult> {
  const result: SeedResult = { created: [], existing: [] };
  for (const seed of SEED_CATEGORIES) {
    const { upsertedCount } = await categoryModel.updateOne(
      { slug: seed.slug },
      { $setOnInsert: { ...seed, artworkKey: null, isActive: true } },
      { upsert: true, runValidators: true },
    );
    (upsertedCount > 0 ? result.created : result.existing).push(seed.slug);
  }
  return result;
}
