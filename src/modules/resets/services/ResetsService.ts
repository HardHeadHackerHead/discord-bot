import { Client, ChannelType } from 'discord.js';
import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { resetAlertEmbed } from '../embeds.js';

const logger = new Logger('Resets:Service');

const CLAUDE_URL = 'https://claude-resets.com/api/resets';
const CODEX_STATUS_URL = 'https://codex-resets.com/api/v1/status';
const CODEX_RESETS_URL = 'https://codex-resets.com/api/v1/resets';

const POLL_INTERVAL_MS = 2 * 60 * 1000;
const CACHE_TTL_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

export type Provider = 'claude' | 'codex';

/** Normalized reset, regardless of which site it came from. */
export interface ResetEvent {
  provider: Provider;
  id: string;
  date: Date;
  banked: boolean;
  scope: string | null;
  note: string;
  url: string | null;
  usableUntil: Date | null;
}

export interface ProviderSnapshot {
  /** Newest first */
  resets: ResetEvent[];
  total: number;
  avgIntervalDays: number | null;
}

export interface AlertConfig extends RowDataPacket {
  guild_id: string;
  channel_id: string;
  ping_role_id: string | null;
  claude_enabled: boolean;
  codex_enabled: boolean;
}

export class ResetsService {
  private cache = new Map<Provider, { at: number; data: ProviderSnapshot }>();
  private timer: NodeJS.Timeout | null = null;
  private polling = false;

  constructor(private db: DatabaseService) {}

  // ==================== Fetching ====================

  private async fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'QuadsLabBot resets module' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`${url} responded ${res.status}`);
    return (await res.json()) as T;
  }

  /** Cached for a minute so command spam and the poller share one request. */
  async get(provider: Provider, force = false): Promise<ProviderSnapshot> {
    const hit = this.cache.get(provider);
    if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;

    const data = provider === 'claude' ? await this.fetchClaude() : await this.fetchCodex();
    this.cache.set(provider, { at: Date.now(), data });
    return data;
  }

  private async fetchClaude(): Promise<ProviderSnapshot> {
    const json = await this.fetchJson<{
      providers: { claude: { events: Array<Record<string, unknown>> } };
    }>(CLAUDE_URL);

    const resets = json.providers.claude.events
      // "policy" events change limits without clearing counters - not a reset
      .filter((e) => e['kind'] === 'reset')
      .map<ResetEvent>((e) => ({
        provider: 'claude',
        id: String(e['id']),
        date: new Date(String(e['date'])),
        banked: e['resetType'] === 'banked',
        scope: typeof e['scope'] === 'string' ? e['scope'] : null,
        note: typeof e['note'] === 'string' ? e['note'] : '',
        url: typeof e['url'] === 'string' ? e['url'] : null,
        usableUntil: typeof e['usableUntil'] === 'string' ? new Date(e['usableUntil']) : null,
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    return { resets, total: resets.length, avgIntervalDays: averageGapDays(resets) };
  }

  private async fetchCodex(): Promise<ProviderSnapshot> {
    const [list, status] = await Promise.all([
      this.fetchJson<{ data: Array<Record<string, any>> }>(CODEX_RESETS_URL),
      this.fetchJson<{ data: { stats?: { total?: number; avg_interval_days?: number } } }>(CODEX_STATUS_URL)
        .catch(() => null),
    ]);

    const resets = list.data
      .map<ResetEvent>((e) => ({
        provider: 'codex',
        id: String(e['id']),
        date: new Date(String(e['announced_at'])),
        banked: e['reset_type'] === 'banked',
        scope: null,
        note: typeof e['text'] === 'string' ? e['text'] : '',
        url: e['source']?.url ?? null,
        usableUntil: null,
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime());

    return {
      resets,
      total: status?.data.stats?.total ?? resets.length,
      avgIntervalDays: status?.data.stats?.avg_interval_days ?? averageGapDays(resets),
    };
  }

  // ==================== Alert config ====================

  async getConfig(guildId: string): Promise<AlertConfig | null> {
    const rows = await this.db.query<AlertConfig[]>(
      'SELECT * FROM resets_alert_channels WHERE guild_id = ?',
      [guildId]
    );
    return rows[0] ?? null;
  }

  async setConfig(
    guildId: string,
    channelId: string,
    opts: { pingRoleId?: string | null; claude?: boolean; codex?: boolean }
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO resets_alert_channels (guild_id, channel_id, ping_role_id, claude_enabled, codex_enabled)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (guild_id) DO UPDATE SET
         channel_id = EXCLUDED.channel_id,
         ping_role_id = EXCLUDED.ping_role_id,
         claude_enabled = EXCLUDED.claude_enabled,
         codex_enabled = EXCLUDED.codex_enabled`,
      [guildId, channelId, opts.pingRoleId ?? null, opts.claude ?? true, opts.codex ?? true]
    );
  }

  async clearConfig(guildId: string): Promise<boolean> {
    const res = await this.db.execute('DELETE FROM resets_alert_channels WHERE guild_id = ?', [guildId]);
    return res.affectedRows > 0;
  }

  // ==================== Polling / alerts ====================

  start(client: Client): void {
    if (this.timer) return;
    // First poll shortly after boot (seeds history silently), then on an interval
    setTimeout(() => void this.poll(client), 10_000).unref();
    this.timer = setInterval(() => void this.poll(client), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async poll(client: Client): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const provider of ['claude', 'codex'] as const) {
        try {
          await this.pollProvider(client, provider);
        } catch (error) {
          logger.warn(`Poll failed for ${provider}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } finally {
      this.polling = false;
    }
  }

  private async pollProvider(client: Client, provider: Provider): Promise<void> {
    const snapshot = await this.get(provider, true);
    if (snapshot.resets.length === 0) return; // Treat an empty payload as a bad response

    const seenRows = await this.db.query<(RowDataPacket & { event_id: string })[]>(
      'SELECT event_id FROM resets_seen WHERE provider = ?',
      [provider]
    );
    const seen = new Set(seenRows.map((r) => r.event_id));
    const fresh = snapshot.resets.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) return;

    // Record first so a failed post never causes a duplicate alert on the next poll
    for (const r of fresh) {
      await this.db.execute(
        'INSERT INTO resets_seen (provider, event_id) VALUES (?, ?) ON CONFLICT DO NOTHING',
        [provider, r.id]
      );
    }

    // First ever run for this provider: just remember history, don't announce it
    if (seen.size === 0) {
      logger.info(`Seeded ${fresh.length} existing ${provider} resets`);
      return;
    }

    // Anything older than a day showing up late (site backfill) isn't "just happened"
    const announce = fresh
      .filter((r) => Date.now() - r.date.getTime() < 24 * 60 * 60 * 1000)
      .reverse(); // oldest first
    for (const reset of announce) await this.announce(client, reset);
  }

  private async announce(client: Client, reset: ResetEvent): Promise<void> {
    const column = reset.provider === 'claude' ? 'claude_enabled' : 'codex_enabled';
    const configs = await this.db.query<AlertConfig[]>(
      `SELECT * FROM resets_alert_channels WHERE ${column} = TRUE`
    );

    for (const cfg of configs) {
      try {
        const channel = client.channels.cache.get(cfg.channel_id)
          ?? await client.channels.fetch(cfg.channel_id).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildText) continue;

        await channel.send({
          content: cfg.ping_role_id ? `<@&${cfg.ping_role_id}>` : undefined,
          embeds: [resetAlertEmbed(reset)],
          allowedMentions: cfg.ping_role_id ? { roles: [cfg.ping_role_id] } : { parse: [] },
        });
      } catch (error) {
        logger.error(`Failed to post ${reset.provider} reset alert to guild ${cfg.guild_id}:`, error);
      }
    }
    logger.info(`Announced ${reset.provider} reset ${reset.id} to ${configs.length} guild(s)`);
  }
}

function averageGapDays(resetsNewestFirst: ResetEvent[]): number | null {
  if (resetsNewestFirst.length < 2) return null;
  const newest = resetsNewestFirst[0]!.date.getTime();
  const oldest = resetsNewestFirst[resetsNewestFirst.length - 1]!.date.getTime();
  return (newest - oldest) / (resetsNewestFirst.length - 1) / 86_400_000;
}
