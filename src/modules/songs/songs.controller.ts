import { Controller, Get, Header, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { ParseObjectIdPipe } from '@nestjs/mongoose';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type {
  MostPlayedSongDto,
  Paginated,
  PlayRecordedDto,
  SongDto,
  StreamUrlDto,
} from '@wedding/shared';
import type { Types } from 'mongoose';
import { ListSongsQueryDto } from './dto/list-songs.query';
import { MostPlayedQueryDto } from './dto/most-played.query';
import { SongsService } from './songs.service';

@ApiTags('songs')
@Controller('songs')
export class SongsController {
  constructor(private readonly songsService: SongsService) {}

  @Get()
  @ApiOperation({ summary: 'List active songs, optionally filtered by category and search text' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  @ApiNotFoundResponse({ description: 'Unknown category slug' })
  list(@Query() query: ListSongsQueryDto): Promise<Paginated<SongDto>> {
    return this.songsService.list(query);
  }

  // Declared before ':id' so "most-played" is not parsed as a song id.
  @Get('most-played')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Songs listened to at least once, most plays first (paginated)' })
  @ApiBadRequestResponse({ description: 'Invalid query parameters' })
  mostPlayed(@Query() query: MostPlayedQueryDto): Promise<Paginated<MostPlayedSongDto>> {
    return this.songsService.mostPlayed(query);
  }

  @Post(':id/plays')
  @HttpCode(200)
  // A real listener records at most one play per ~30 s; anything faster is not listening.
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Count one listen of a song (called by the player)' })
  @ApiParam({ name: 'id', description: 'Song ObjectId' })
  @ApiNotFoundResponse({ description: 'Song not found or inactive' })
  recordPlay(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<PlayRecordedDto> {
    return this.songsService.recordPlay(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one active song' })
  @ApiParam({ name: 'id', description: 'Song ObjectId' })
  @ApiNotFoundResponse({ description: 'Song not found or inactive' })
  getById(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<SongDto> {
    return this.songsService.getById(id);
  }

  @Get(':id/artwork')
  @SkipThrottle() // a song list renders many images at once; this only signs a URL
  @ApiOperation({ summary: 'Redirect (302) to a fresh short-lived URL of the cover image' })
  @ApiParam({ name: 'id', description: 'Song ObjectId' })
  @ApiNotFoundResponse({ description: 'Song not found, inactive, or without artwork' })
  async getArtwork(
    @Param('id', ParseObjectIdPipe) id: Types.ObjectId,
    @Res() res: Response,
  ): Promise<void> {
    const url = await this.songsService.getArtworkUrl(id);
    // Shorter than the signed URL's lifetime, so a cached redirect never points at an expired URL.
    res.setHeader('Cache-Control', 'public, max-age=300');
    // <img> on the web origin is a cross-origin, no-cors load; Helmet's default would block it.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.redirect(302, url);
  }

  @Get(':id/stream-url')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Get a short-lived URL for the audio file (supports HTTP Range for seeking)',
  })
  @ApiParam({ name: 'id', description: 'Song ObjectId' })
  @ApiNotFoundResponse({ description: 'Song not found or inactive' })
  getStreamUrl(@Param('id', ParseObjectIdPipe) id: Types.ObjectId): Promise<StreamUrlDto> {
    return this.songsService.getStreamUrl(id);
  }
}
