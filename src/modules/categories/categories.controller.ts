import { Controller, Get, Param } from '@nestjs/common';
import { ApiNotFoundResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CategoryDto } from '@wedding/shared';
import { SlugParamDto } from '../../common/dto/slug-param.dto';
import { CategoriesService } from './categories.service';

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'List active categories with their song counts' })
  list(): Promise<CategoryDto[]> {
    return this.categoriesService.listActive();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get one active category by slug' })
  @ApiNotFoundResponse({ description: 'No active category with this slug' })
  getBySlug(@Param() { slug }: SlugParamDto): Promise<CategoryDto> {
    return this.categoriesService.getActiveBySlug(slug);
  }
}
