/**
 * Development-only MongoDB: runs a real mongod (binary managed by mongodb-memory-server)
 * on 127.0.0.1:27017 with data persisted in apps/api/.data/mongo, so no system install is needed.
 * Stop with Ctrl+C. Production uses MongoDB Atlas.
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

const dbPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.data', 'mongo');
mkdirSync(dbPath, { recursive: true });

const server = await MongoMemoryServer.create({
  instance: { ip: '127.0.0.1', port: 27017, dbPath, storageEngine: 'wiredTiger' },
});
process.stdout.write(
  `Dev MongoDB running at ${server.getUri()} (data: ${dbPath}). Ctrl+C to stop.\n`,
);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  // doCleanup:false keeps the data directory between runs.
  await server.stop({ doCleanup: false });
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
