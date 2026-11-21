import { Injectable } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { HealthStatus } from '@wedding/shared';
import { ConnectionStates, type Connection } from 'mongoose';

const DB_PING_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(@InjectConnection() private readonly connection: Connection) {}

  async check(): Promise<HealthStatus> {
    const database = await this.checkDatabase();
    return {
      status: database.status === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      checks: { database },
    };
  }

  /** Runs a real `ping` round-trip; `readyState` alone can report connected on a dead socket. */
  private async checkDatabase(): Promise<HealthStatus['checks']['database']> {
    const db = this.connection.db;
    if (this.connection.readyState !== ConnectionStates.connected || !db) {
      return { status: 'down', latencyMs: null };
    }

    const startedAt = performance.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        db.admin().ping(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('ping timeout')), DB_PING_TIMEOUT_MS);
        }),
      ]);
      return { status: 'up', latencyMs: Math.round(performance.now() - startedAt) };
    } catch {
      return { status: 'down', latencyMs: null };
    } finally {
      clearTimeout(timer);
    }
  }
}
