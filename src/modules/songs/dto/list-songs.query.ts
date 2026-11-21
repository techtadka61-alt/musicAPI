import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  SEARCH_MAX_LENGTH,
  SLUG_PATTERN,
  SONGS_DEFAULT_PAGE_SIZE,
  SONGS_MAX_PAGE_SIZE,
} from '@wedding/shared';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class ListSongsQueryDto {
  @ApiPropertyOptional({ description: 'Category slug', example: 'hindi' })
  @IsOptional()
  @Matches(SLUG_PATTERN, { message: 'category must be a category slug' })
  category?: string;

  @ApiPropertyOptional({ description: 'Case-insensitive match on title, artist or album' })
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_MAX_LENGTH)
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  search?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page: number = 1;

  @ApiPropertyOptional({
    default: SONGS_DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: SONGS_MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SONGS_MAX_PAGE_SIZE)
  limit: number = SONGS_DEFAULT_PAGE_SIZE;
}
