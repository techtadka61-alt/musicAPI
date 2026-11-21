import path from 'node:path';
import { parseArgs } from 'node:util';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Category } from '../modules/categories/schemas/category.schema';
import { Song } from '../modules/songs/schemas/song.schema';
import { StorageService } from '../modules/storage/storage.service';
import { checkStorage } from './check-storage';
import { CliModule } from './cli.module';
import { importSongs } from './import-songs';
import { scanSongs } from './scan-songs';
import { seedCategories } from './seed-categories';

const USAGE = `Usage: node dist/cli/main.js <command> [options]

Commands:
  seed                          Create the Hindi, Bhojpuri and Punjabi categories (safe to re-run)
  songs:scan --dir <folder>     Scan <folder>/<category>/*.mp3 into a manifest for review
             [--manifest <file>]  (default: <folder>/songs-manifest.json)
  songs:import [--manifest <file>]
                                Upload new songs to storage and save/update metadata in MongoDB
                                (default manifest: ./songs-manifest.json)
  storage:check                 Verify every song's file exists in storage with the right size

Relative paths resolve from the directory the command was started in.`;

const print = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

/** pnpm runs scripts inside apps/api; INIT_CWD is where the user actually typed the command. */
const resolveFromInvocationDir = (target: string): string =>
  path.resolve(process.env.INIT_CWD ?? process.cwd(), target);

async function withContext<T>(
  run: (
    get: <TValue>(token: string | (abstract new (...args: never[]) => TValue)) => TValue,
  ) => Promise<T>,
): Promise<T> {
  const app = await NestFactory.createApplicationContext(CliModule, { logger: ['error', 'warn'] });
  try {
    return await run((token) => app.get(token));
  } finally {
    await app.close();
  }
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { dir: { type: 'string' }, manifest: { type: 'string' }, help: { type: 'boolean' } },
  });
  const [command] = positionals;

  switch (command) {
    case 'seed': {
      const result = await withContext((get) =>
        seedCategories(get<Model<Category>>(getModelToken(Category.name))),
      );
      print(`Categories created: ${result.created.join(', ') || 'none'}`);
      print(`Already present:    ${result.existing.join(', ') || 'none'}`);
      return 0;
    }

    case 'songs:scan': {
      if (!values.dir) {
        print('songs:scan requires --dir <folder>');
        return 1;
      }
      const dir = resolveFromInvocationDir(values.dir);
      const manifestPath = values.manifest
        ? resolveFromInvocationDir(values.manifest)
        : path.join(dir, 'songs-manifest.json');
      const result = await scanSongs(dir, manifestPath);
      print(`Manifest: ${result.manifestPath}`);
      print(`New songs added: ${result.added.length}, existing kept: ${result.kept}`);
      for (const entry of result.added) print(`  + [${entry.category}] ${entry.title}`);
      for (const skip of result.skipped) print(`  skipped ${skip.file}: ${skip.reason}`);
      for (const file of result.missingFiles) print(`  file missing (entry kept): ${file}`);
      print('\nReview titles/artists/categories in the manifest, then run songs:import.');
      return 0;
    }

    case 'songs:import': {
      const manifestPath = resolveFromInvocationDir(values.manifest ?? 'songs-manifest.json');
      const result = await withContext((get) =>
        importSongs(
          {
            songModel: get<Model<Song>>(getModelToken(Song.name)),
            categoryModel: get<Model<Category>>(getModelToken(Category.name)),
            storage: get(StorageService),
            onProgress: (line) => print(`  ${line}`),
          },
          manifestPath,
        ),
      );
      print(
        `\nCreated ${result.created.length}, updated ${result.updated.length}, ` +
          `unchanged ${result.unchanged}, failed ${result.failed.length}`,
      );
      for (const warning of result.warnings) print(`  warning: ${warning}`);
      for (const failure of result.failed) print(`  FAILED ${failure.file}: ${failure.error}`);
      return result.failed.length > 0 ? 1 : 0;
    }

    case 'storage:check': {
      const result = await withContext((get) =>
        checkStorage(get<Model<Song>>(getModelToken(Song.name)), get(StorageService)),
      );
      print(`Checked ${result.checked} songs: ${result.problems.length} problem(s)`);
      for (const problem of result.problems) print(`  ${problem}`);
      return result.problems.length > 0 ? 1 : 0;
    }

    default:
      print(USAGE);
      return command && !values.help ? 1 : 0;
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  },
);
