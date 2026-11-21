import { ApiProperty } from '@nestjs/swagger';
import { SLUG_PATTERN } from '@wedding/shared';
import { Matches } from 'class-validator';

export class SlugParamDto {
  @ApiProperty({ example: 'hindi' })
  @Matches(SLUG_PATTERN, { message: 'slug must be lowercase letters, digits and hyphens' })
  slug: string;
}
