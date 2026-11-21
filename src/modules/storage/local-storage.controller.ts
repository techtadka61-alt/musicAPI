import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsInt, IsString, Matches } from 'class-validator';
import type { Response } from 'express';
import { LocalStorageDriver } from './drivers/local-storage.driver';
import { OBJECT_KEY_PATTERN, STORAGE_DRIVER, type StorageDriver } from './storage.types';

export class LocalFileQueryDto {
  @Matches(OBJECT_KEY_PATTERN)
  key: string;

  @Type(() => Number)
  @IsInt()
  expires: number;

  @IsString()
  signature: string;
}

/**
 * Serves files for the development-only local storage driver, standing in for S3 pre-signed
 * URLs. Returns 404 when the S3 driver is active. Express `sendFile` handles Range requests,
 * so audio seeking works the same as with S3.
 */
@ApiExcludeController()
@SkipThrottle() // a single song playback issues many Range requests; the signature is the guard
@Controller('storage/local')
export class LocalStorageController {
  private readonly logger = new Logger(LocalStorageController.name);

  constructor(@Inject(STORAGE_DRIVER) private readonly driver: StorageDriver) {}

  @Get()
  async serve(@Query() query: LocalFileQueryDto, @Res() res: Response): Promise<void> {
    if (!(this.driver instanceof LocalStorageDriver)) {
      throw new NotFoundException();
    }
    if (!this.driver.verifySignature(query.key, query.expires, query.signature)) {
      throw new ForbiddenException('Link is invalid or has expired');
    }
    if (!(await this.driver.headObject(query.key))) {
      throw new NotFoundException('File not found');
    }

    // Helmet defaults to same-origin; the web app on another origin must be able to load media.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    // Serve relative to `root`: express/send rejects absolute paths containing dot-folders
    // (like the default `.storage`) but only checks the part below `root`.
    res.sendFile(query.key, { root: this.driver.rootDir, acceptRanges: true }, (error) => {
      // Aborted Range requests (normal while seeking) arrive here after headers were sent.
      if (error && !res.headersSent) {
        this.logger.error(`Serving ${query.key} failed: ${error.message}`);
        res.sendStatus(500);
      }
    });
  }
}
