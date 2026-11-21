import { ApiPropertyOptional } from '@nestjs/swagger';
import { MOST_PLAYED_DEFAULT_PAGE_SIZE, SONGS_MAX_PAGE_SIZE } from '@wedding/shared';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class MostPlayedQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  page: number = 1;

  @ApiPropertyOptional({
    default: MOST_PLAYED_DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: SONGS_MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(SONGS_MAX_PAGE_SIZE)
  limit: number = MOST_PLAYED_DEFAULT_PAGE_SIZE;
}
