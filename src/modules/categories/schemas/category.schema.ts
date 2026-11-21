import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SLUG_PATTERN } from '@wedding/shared';
import type { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'categories', timestamps: true })
export class Category {
  @Prop({ required: true, trim: true, maxlength: 60 })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true, match: SLUG_PATTERN })
  slug: string;

  @Prop({ type: String, default: null, trim: true, maxlength: 500 })
  description: string | null;

  /** Storage key of the category image, e.g. `artwork/categories/<id>.jpg`. */
  @Prop({ type: String, default: null })
  artworkKey: string | null;

  /** Display order on the home page (ascending). */
  @Prop({ required: true, default: 0 })
  sortOrder: number;

  @Prop({ required: true, default: true })
  isActive: boolean;

  createdAt: Date;
  updatedAt: Date;
}

export type CategoryDocument = HydratedDocument<Category>;
export type CategoryRecord = Category & { _id: Types.ObjectId };

export const CategorySchema = SchemaFactory.createForClass(Category);
CategorySchema.index({ isActive: 1, sortOrder: 1 });
