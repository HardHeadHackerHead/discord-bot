import pg from 'pg';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Strava:Listen');

const NOTIFY_CHANNEL = 'strava_activity';

/**
 * Maintains a persistent LISTEN connection to the quadslab.io
 * Postgres database. The website's webhook processor issues
 * `NOTIFY strava_activity, '<event_id>'` after writing each activity
 * event row; we wake on the notification and hand the event id to the
 * dispatcher.
 *
 * Also exposes a query helper (`query`) backed by a separate small
 * pool so the dispatcher can SELECT event/integration rows from the
 * website DB without competing with the long-lived LISTEN connection.
 *
 * Reconnects with exponential backoff on errors, and triggers a
 * catch-up sweep after every successful reconnect so we don't lose
 * notifications that fired while we were down.
 */
export interface ListenHandler {
  handleEvent(eventId: string): Promise<void>;
  catchUp(): Promise<void>;
}

export class StravaListenService {
  private client: pg.Client | null = null;
  private readonly pool: pg.Pool;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly websiteDbUrl: string,
    private readonly handler: ListenHandler,
  ) {
    this.pool = new pg.Pool({
      connectionString: websiteDbUrl,
      max: 3,
      // Read-only by convention; the website DB role should enforce.
      application_name: 'quadslabbot-strava',
    });
  }

  async start(): Promise<void> {
    await this.connectAndListen();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.client) {
      try {
        await this.client.end();
      } catch {
        /* already torn down */
      }
      this.client = null;
    }
    await this.pool.end().catch(() => {
      /* ignore */
    });
  }

  /** Run a SELECT against the website DB. */
  async query<T extends Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  // ─── internals ──────────────────────────────────────────────────

  private async connectAndListen(): Promise<void> {
    if (this.stopped) return;

    const client = new pg.Client({
      connectionString: this.websiteDbUrl,
      application_name: 'quadslabbot-strava-listen',
    });
    this.client = client;

    client.on('notification', (msg) => {
      if (msg.channel !== NOTIFY_CHANNEL || !msg.payload) return;
      // Don't await — the listener callback is invoked for many events
      // sequentially; treat each as fire-and-forget so a slow handler
      // doesn't block the next notification's delivery.
      void this.handler.handleEvent(msg.payload).catch((err) => {
        logger.error(`handleEvent(${msg.payload}) failed:`, err);
      });
    });

    client.on('error', (err) => {
      logger.error('LISTEN client error:', err);
      this.scheduleReconnect();
    });

    client.on('end', () => {
      if (this.stopped) return;
      logger.warn('LISTEN client connection ended');
      this.scheduleReconnect();
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${NOTIFY_CHANNEL}`);
      logger.info(`Subscribed to ${NOTIFY_CHANNEL} on website DB`);
      this.reconnectAttempts = 0;

      // Sweep any events that landed (or weren't dispatched) while we
      // were disconnected. Best-effort — errors are logged inside.
      void this.handler.catchUp().catch((err) => {
        logger.error('catchUp failed:', err);
      });
    } catch (err) {
      logger.error('LISTEN connect failed:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    if (this.reconnectTimer) return; // already scheduled

    if (this.client) {
      try {
        this.client.removeAllListeners();
        void this.client.end().catch(() => {
          /* ignore */
        });
      } catch {
        /* ignore */
      }
      this.client = null;
    }

    const delayMs = Math.min(60_000, 1000 * Math.pow(2, this.reconnectAttempts));
    this.reconnectAttempts += 1;
    logger.warn(
      `reconnecting LISTEN in ${delayMs}ms (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectAndListen();
    }, delayMs);
  }
}
