import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getModelToken } from '@nestjs/mongoose';
import {
  apiResponseSchema,
  categorySchema,
  mostPlayedSongSchema,
  paginatedSchema,
  songSchema,
  streamUrlSchema,
  type SongDto,
} from '@wedding/shared';
import type { Model } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkStorage } from '../src/cli/check-storage';
import { importSongs, type ImportDeps } from '../src/cli/import-songs';
import { scanSongs } from '../src/cli/scan-songs';
import { seedCategories } from '../src/cli/seed-categories';
import { readManifest, writeManifest } from '../src/cli/songs-manifest';
import { LocalUrlSigner } from '../src/modules/storage/drivers/local-url-signer';
import type { Category } from '../src/modules/categories/schemas/category.schema';
import type { Song } from '../src/modules/songs/schemas/song.schema';
import { StorageService } from '../src/modules/storage/storage.service';
import { buildMp3, expectedDurationSeconds, FAKE_JPEG } from './helpers/mp3-fixture';
import {
  createTestApp,
  TEST_SIGNING_SECRET,
  toRequestPath,
  type TestContext,
} from './helpers/test-app';

const songListSchema = apiResponseSchema(paginatedSchema(songSchema));
const categoryListSchema = apiResponseSchema(z.array(categorySchema));
const mostPlayedSchema = apiResponseSchema(paginatedSchema(mostPlayedSongSchema));

function dataOf<T>(body: { success: true; data: T } | { success: false }): T {
  if (!body.success) throw new Error('expected success envelope');
  return body.data;
}

describe('Catalog: seed → scan → import → API (e2e)', () => {
  let ctx: TestContext;
  let musicDir: string;
  let manifestPath: string;
  let deps: ImportDeps;
  let server: ReturnType<TestContext['app']['getHttpServer']>;

  const listSongs = async (
    query = '',
  ): Promise<{ data: SongDto[]; total: number; totalPages: number }> => {
    const res = await request(server).get(`/api/v1/songs${query}`).expect(200);
    const page = dataOf(songListSchema.parse(res.body));
    return { data: page.items, total: page.total, totalPages: page.totalPages };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    server = ctx.app.getHttpServer();
    deps = {
      songModel: ctx.app.get<Model<Song>>(getModelToken('Song')),
      categoryModel: ctx.app.get<Model<Category>>(getModelToken('Category')),
      storage: ctx.app.get(StorageService),
    };

    // Same layout as the real music folder: <dir>/<Category>/*.mp3 (folder case is ignored).
    musicDir = await mkdtemp(path.join(tmpdir(), 'wedding-music-'));
    manifestPath = path.join(musicDir, 'songs-manifest.json');
    await mkdir(path.join(musicDir, 'HIndi'));
    await mkdir(path.join(musicDir, 'Bhojpuri'));
    await mkdir(path.join(musicDir, 'Haryanvi'));
    await writeFile(
      path.join(musicDir, 'HIndi', 'Sajan Sajan Teri Dulhan_320(KoshalWorld.Com).mp3'),
      buildMp3({ frames: 80 }),
    );
    await writeFile(
      path.join(musicDir, 'HIndi', 'track2.mp3'),
      buildMp3({
        title: 'Mehndi Hai Rachne Wali',
        artist: 'Alka Yagnik',
        picture: { mimeType: 'image/jpeg', data: FAKE_JPEG },
      }),
    );
    await writeFile(
      path.join(musicDir, 'Bhojpuri', 'song.mp3'),
      buildMp3({ title: 'लॉलीपॉप लागेलू', artist: 'Pawan Singh', frames: 60 }),
    );
    await writeFile(path.join(musicDir, 'Bhojpuri', 'cover.jpg'), FAKE_JPEG);
    await writeFile(path.join(musicDir, 'Bhojpuri', 'fake.mp3'), Buffer.from('not really audio'));
    await writeFile(
      path.join(musicDir, 'Haryanvi', 'x.mp3'),
      buildMp3({ title: 'Haryanvi Song', frames: 40 }),
    );
  });

  afterAll(async () => {
    await ctx?.close();
    if (musicDir) await rm(musicDir, { recursive: true, force: true });
  });

  it('seeds exactly the three categories and is idempotent', async () => {
    expect(await seedCategories(deps.categoryModel)).toEqual({
      created: ['hindi', 'bhojpuri', 'punjabi'],
      existing: [],
    });
    expect(await seedCategories(deps.categoryModel)).toEqual({
      created: [],
      existing: ['hindi', 'bhojpuri', 'punjabi'],
    });
    expect(await deps.categoryModel.countDocuments()).toBe(3);
  });

  it('scans folders into a manifest with cleaned titles, skipping non-MP3 content', async () => {
    const result = await scanSongs(musicDir, manifestPath);

    expect(result.added.map((e) => [e.category, e.title, e.artist])).toEqual([
      ['bhojpuri', 'लॉलीपॉप लागेलू', 'Pawan Singh'],
      ['haryanvi', 'Haryanvi Song', null],
      ['hindi', 'Sajan Sajan Teri Dulhan', null],
      ['hindi', 'Mehndi Hai Rachne Wali', 'Alka Yagnik'],
    ]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { file: 'Bhojpuri/cover.jpg', reason: 'not an .mp3 file' },
        expect.objectContaining({ file: 'Bhojpuri/fake.mp3' }),
      ]),
    );
  });

  it('re-scanning keeps hand edits (matched by checksum)', async () => {
    const manifest = (await readManifest(manifestPath))!;
    const sajan = manifest.songs.find((s) => s.title === 'Sajan Sajan Teri Dulhan')!;
    sajan.artist = 'Kumar Sanu';
    await writeManifest(manifestPath, manifest);

    const rescan = await scanSongs(musicDir, manifestPath);
    expect(rescan.added).toHaveLength(0);
    expect(rescan.kept).toBe(4);
    const after = (await readManifest(manifestPath))!;
    expect(after.songs.find((s) => s.checksum === sajan.checksum)?.artist).toBe('Kumar Sanu');
  });

  it('imports songs, uploading files before writing metadata; unknown categories fail individually', async () => {
    const result = await importSongs(deps, manifestPath);

    expect(result.created.sort()).toEqual(
      ['Mehndi Hai Rachne Wali', 'Sajan Sajan Teri Dulhan', 'लॉलीपॉप लागेलू'].sort(),
    );
    expect(result.failed).toEqual([
      { file: 'Haryanvi/x.mp3', error: expect.stringContaining('Unknown category "haryanvi"') },
    ]);
    expect(await deps.songModel.countDocuments()).toBe(3);

    const song = await deps.songModel.findOne({ title: 'Sajan Sajan Teri Dulhan' }).lean();
    expect(song).toMatchObject({
      artist: 'Kumar Sanu',
      mimeType: 'audio/mpeg',
      storageProvider: 'local',
      audioKey: `music/${song!._id.toString()}.mp3`,
      artworkKey: null,
      sourceFile: 'Sajan Sajan Teri Dulhan_320(KoshalWorld.Com).mp3',
    });
    expect(song!.durationSeconds).toBeCloseTo(expectedDurationSeconds(80), 1);
    // The stored object is byte-identical to the source file.
    const stored = await readFile(
      path.join(ctx.storageDir, 'music', `${song!._id.toString()}.mp3`),
    );
    const source = await readFile(
      path.join(musicDir, 'HIndi', 'Sajan Sajan Teri Dulhan_320(KoshalWorld.Com).mp3'),
    );
    expect(stored.equals(source)).toBe(true);
  });

  it('re-running import is a no-op; manifest edits (incl. recategorising) become updates', async () => {
    const manifest = (await readManifest(manifestPath))!;
    manifest.songs = manifest.songs.filter((s) => s.category !== 'haryanvi');
    const haryanviFixed = manifest.songs.find((s) => s.title === 'Mehndi Hai Rachne Wali')!;
    haryanviFixed.title = 'Mehndi Hai Rachne Waali';
    await writeManifest(manifestPath, manifest);

    const result = await importSongs(deps, manifestPath);
    expect(result.created).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(result.unchanged).toBe(2);
    expect(result.updated).toEqual(['Mehndi Hai Rachne Waali (title)']);
    expect(await deps.songModel.countDocuments()).toBe(3);
  });

  it('GET /categories lists categories in display order with song counts', async () => {
    const res = await request(server).get('/api/v1/categories').expect(200);
    const categories = dataOf(categoryListSchema.parse(res.body));
    expect(categories.map((c) => [c.slug, c.name, c.songCount])).toEqual([
      ['hindi', 'Hindi', 2],
      ['bhojpuri', 'Bhojpuri', 1],
      ['punjabi', 'Punjabi', 0],
    ]);
  });

  it('GET /categories/:slug returns one category, 404 for unknown, 400 for malformed', async () => {
    const res = await request(server).get('/api/v1/categories/bhojpuri').expect(200);
    expect(res.body.data).toMatchObject({ slug: 'bhojpuri', songCount: 1 });

    await request(server).get('/api/v1/categories/rajasthani').expect(404);
    const bad = await request(server).get('/api/v1/categories/Bad_Slug').expect(400);
    expect(bad.body.error.code).toBe('BAD_REQUEST');
  });

  it('GET /songs filters by category, sorts by title, and paginates', async () => {
    const hindi = await listSongs('?category=hindi');
    expect(hindi.data.map((s) => s.title)).toEqual([
      'Mehndi Hai Rachne Waali',
      'Sajan Sajan Teri Dulhan',
    ]);
    expect(hindi.data.every((s) => s.category.slug === 'hindi')).toBe(true);

    const page2 = await listSongs('?limit=2&page=2');
    expect(page2.total).toBe(3);
    expect(page2.totalPages).toBe(2);
    expect(page2.data).toHaveLength(1);

    await request(server).get('/api/v1/songs?category=rajasthani').expect(404);
  });

  it('GET /songs?search matches title/artist case-insensitively and treats regex characters literally', async () => {
    expect((await listSongs('?search=sajan')).data.map((s) => s.title)).toEqual([
      'Sajan Sajan Teri Dulhan',
    ]);
    expect((await listSongs('?search=PAWAN')).data.map((s) => s.title)).toEqual(['लॉलीपॉप लागेलू']);
    expect((await listSongs(`?search=${encodeURIComponent('लॉलीपॉप')}`)).total).toBe(1);
    expect((await listSongs(`?search=${encodeURIComponent('(.*')}`)).total).toBe(0);
  });

  it('GET /songs rejects invalid query parameters with field details', async () => {
    const res = await request(server).get('/api/v1/songs?limit=500&page=0&foo=1').expect(400);
    expect(res.body.error.message).toBe('Validation failed');
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('limit'),
        expect.stringContaining('page'),
        expect.stringContaining('foo'),
      ]),
    );
  });

  it('exposes artwork only when the MP3 had embedded cover art', async () => {
    const { data } = await listSongs('?category=hindi');
    const withArt = data.find((s) => s.title === 'Mehndi Hai Rachne Waali')!;
    const withoutArt = data.find((s) => s.title === 'Sajan Sajan Teri Dulhan')!;
    expect(withoutArt.artworkUrl).toBeNull();
    // Stable URL that clients can keep in saved queues; it never expires itself.
    expect(withArt.artworkUrl).toBe(`http://localhost:4000/api/v1/songs/${withArt.id}/artwork`);

    const redirect = await request(server).get(toRequestPath(withArt.artworkUrl!)).expect(302);
    expect(redirect.headers['cache-control']).toBe('public, max-age=300');
    expect(redirect.headers['cross-origin-resource-policy']).toBe('cross-origin');
    const image = await request(server).get(toRequestPath(redirect.headers.location!)).expect(200);
    expect(image.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.compare(image.body as Buffer, FAKE_JPEG)).toBe(0);

    await request(server).get(`/api/v1/songs/${withoutArt.id}/artwork`).expect(404);
  });

  it('artwork redirects are not rate-limited (a list renders many images at once)', async () => {
    const { data } = await listSongs('?category=hindi');
    const withArt = data.find((s) => s.artworkUrl)!;
    const res = await request(server).get(toRequestPath(withArt.artworkUrl!)).expect(302);
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('GET /songs/:id returns a song; 400 for a malformed id; 404 for an unknown id', async () => {
    const [first] = (await listSongs('?category=bhojpuri')).data;
    const res = await request(server).get(`/api/v1/songs/${first!.id}`).expect(200);
    expect(songSchema.parse(res.body.data)).toMatchObject({
      title: 'लॉलीपॉप लागेलू',
      artist: 'Pawan Singh',
    });

    await request(server).get('/api/v1/songs/not-an-id').expect(400);
    await request(server).get('/api/v1/songs/6650f0c2a1b2c3d4e5f60718').expect(404);
  });

  it('stream URL serves the exact audio bytes, supports Range requests, and can be loaded cross-origin', async () => {
    const [song] = (await listSongs('?category=bhojpuri')).data;
    const res = await request(server).get(`/api/v1/songs/${song!.id}/stream-url`).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const stream = streamUrlSchema.parse(res.body.data);
    expect(stream).toMatchObject({
      mimeType: 'audio/mpeg',
      fileSize: song!.fileSize,
      checksum: song!.checksum,
    });

    const full = await request(server).get(toRequestPath(stream.url)).buffer(true).expect(200);
    expect(full.headers['content-type']).toBe('audio/mpeg');
    expect(full.headers['accept-ranges']).toBe('bytes');
    expect(full.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect((full.body as Buffer).length).toBe(song!.fileSize);

    const partial = await request(server)
      .get(toRequestPath(stream.url))
      .set('Range', 'bytes=100-199')
      .buffer(true)
      .expect(206);
    expect(partial.headers['content-range']).toBe(`bytes 100-199/${song!.fileSize}`);
    expect((partial.body as Buffer).equals((full.body as Buffer).subarray(100, 200))).toBe(true);
  });

  it('rejects tampered, expired and path-traversal storage links', async () => {
    const [song] = (await listSongs('?category=bhojpuri')).data;
    const res = await request(server).get(`/api/v1/songs/${song!.id}/stream-url`).expect(200);
    const url = new URL(res.body.data.url as string);

    const otherKey = new URL(url);
    otherKey.searchParams.set('key', 'music/6650f0c2a1b2c3d4e5f60718.mp3');
    await request(server).get(toRequestPath(otherKey.toString())).expect(403);

    const extended = new URL(url);
    extended.searchParams.set('expires', String(Number(url.searchParams.get('expires')) + 3600));
    await request(server).get(toRequestPath(extended.toString())).expect(403);

    const signer = new LocalUrlSigner(TEST_SIGNING_SECRET);
    const key = url.searchParams.get('key')!;
    const past = Math.floor(Date.now() / 1000) - 10;
    const expired = new URL(url);
    expired.searchParams.set('expires', String(past));
    expired.searchParams.set('signature', signer.sign(key, past));
    await request(server).get(toRequestPath(expired.toString())).expect(403);

    const traversal = new URL(url);
    traversal.searchParams.set('key', '../../etc/passwd');
    await request(server).get(toRequestPath(traversal.toString())).expect(400);
  });

  it('counts plays and ranks "most played" by count, paginated; re-import keeps counts', async () => {
    const empty = await request(server).get('/api/v1/songs/most-played').expect(200);
    expect(dataOf(mostPlayedSchema.parse(empty.body))).toMatchObject({ items: [], total: 0 });

    const songs = (await listSongs()).data;
    const byTitle = (title: string) => songs.find((s) => s.title === title)!;
    const play = (song: SongDto) =>
      request(server).post(`/api/v1/songs/${song.id}/plays`).expect(200);

    const sajan = byTitle('Sajan Sajan Teri Dulhan');
    const mehndi = byTitle('Mehndi Hai Rachne Waali');
    await play(sajan);
    await play(mehndi);
    const third = await play(mehndi);
    expect(third.body.data).toEqual({ playCount: 2 });

    const res = await request(server).get('/api/v1/songs/most-played').expect(200);
    const ranking = dataOf(mostPlayedSchema.parse(res.body));
    // Songs never played are left out.
    expect(ranking.items.map((s) => [s.title, s.playCount])).toEqual([
      ['Mehndi Hai Rachne Waali', 2],
      ['Sajan Sajan Teri Dulhan', 1],
    ]);

    const page2 = dataOf(
      mostPlayedSchema.parse(
        (await request(server).get('/api/v1/songs/most-played?limit=1&page=2').expect(200)).body,
      ),
    );
    expect(page2).toMatchObject({ total: 2, totalPages: 2 });
    expect(page2.items.map((s) => s.title)).toEqual(['Sajan Sajan Teri Dulhan']);

    await request(server).post('/api/v1/songs/0123456789abcdef01234567/plays').expect(404);
    await request(server).post('/api/v1/songs/not-an-id/plays').expect(400);
    await request(server).get('/api/v1/songs/most-played?limit=0').expect(400);

    // The import only $sets manifest fields, so counts survive re-imports.
    await importSongs(deps, manifestPath);
    const after = await deps.songModel.findById(mehndi.id).lean();
    expect(after?.playCount).toBe(2);
  });

  it('isActive=false in the manifest hides a song everywhere', async () => {
    const manifest = (await readManifest(manifestPath))!;
    const target = manifest.songs.find((s) => s.title === 'Sajan Sajan Teri Dulhan')!;
    target.isActive = false;
    await writeManifest(manifestPath, manifest);
    await importSongs(deps, manifestPath);

    const id = (await deps.songModel.findOne({ checksum: target.checksum }).lean())!._id.toString();
    expect((await listSongs('?category=hindi')).data.map((s) => s.title)).toEqual([
      'Mehndi Hai Rachne Waali',
    ]);
    await request(server).get(`/api/v1/songs/${id}`).expect(404);
    await request(server).get(`/api/v1/songs/${id}/stream-url`).expect(404);
    const categories = await request(server).get('/api/v1/categories').expect(200);
    expect(categories.body.data[0]).toMatchObject({ slug: 'hindi', songCount: 1 });
    await request(server).post(`/api/v1/songs/${id}/plays`).expect(404);
    const mostPlayed = await request(server).get('/api/v1/songs/most-played').expect(200);
    expect(mostPlayedSchema.parse(mostPlayed.body)).toMatchObject({ success: true });
    expect(mostPlayed.body.data.items.map((s: SongDto) => s.title)).not.toContain(
      'Sajan Sajan Teri Dulhan',
    );
  });

  it('storage:check passes, then reports a missing file', async () => {
    expect(await checkStorage(deps.songModel, deps.storage)).toEqual({ checked: 3, problems: [] });

    const song = (await deps.songModel.findOne({ title: 'लॉलीपॉप लागेलू' }).lean())!;
    await unlink(path.join(ctx.storageDir, ...song.audioKey.split('/')));
    const result = await checkStorage(deps.songModel, deps.storage);
    expect(result.problems).toEqual([expect.stringContaining(`audio missing at ${song.audioKey}`)]);
  });
});
