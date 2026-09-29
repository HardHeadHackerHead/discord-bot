import { Client, VoiceState } from 'discord.js';
import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('DeafenSync:Service');

export interface SyncedUser {
  guild_id: string;
  user_id: string;
  added_by: string;
  enabled: boolean;
  bot_deafened: boolean;
  created_at: Date;
}

export type RemoveResult = 'not-found' | 'removed' | 'released' | 'pending-release';

export class DeafenSyncService {
  /** guildId -> userId -> row. Voice state updates are frequent, so we avoid a DB hit per event. */
  private cache = new Map<string, Map<string, SyncedUser>>();

  /** Per-user promise chain so rapid deafen toggles are applied in order. */
  private locks = new Map<string, Promise<void>>();

  constructor(private db: DatabaseService) {}

  // ==================== Cache ====================

  async loadAll(): Promise<void> {
    const rows = await this.db.query<(SyncedUser & RowDataPacket)[]>(
      'SELECT * FROM deafensync_users'
    );
    this.cache.clear();
    for (const row of rows) this.setCached(row);
    logger.debug(`Loaded ${rows.length} synced users`);
  }

  private setCached(row: SyncedUser): void {
    let guild = this.cache.get(row.guild_id);
    if (!guild) {
      guild = new Map();
      this.cache.set(row.guild_id, guild);
    }
    guild.set(row.user_id, row);
  }

  private deleteCached(guildId: string, userId: string): void {
    this.cache.get(guildId)?.delete(userId);
  }

  get(guildId: string, userId: string): SyncedUser | null {
    return this.cache.get(guildId)?.get(userId) ?? null;
  }

  /** Users actively on the watch list (excludes rows only kept for a pending release). */
  list(guildId: string): SyncedUser[] {
    return [...(this.cache.get(guildId)?.values() ?? [])].filter((u) => u.enabled);
  }

  // ==================== Watch list ====================

  /** Returns false if the user was already on the list. */
  async add(guildId: string, userId: string, addedBy: string): Promise<boolean> {
    const existing = this.get(guildId, userId);
    if (existing?.enabled) return false;

    await this.db.execute(
      `INSERT INTO deafensync_users (guild_id, user_id, added_by, enabled, bot_deafened)
       VALUES (?, ?, ?, TRUE, ?)
       ON CONFLICT (guild_id, user_id) DO UPDATE SET enabled = TRUE, added_by = EXCLUDED.added_by`,
      [guildId, userId, addedBy, existing?.bot_deafened ?? false]
    );

    this.setCached({
      guild_id: guildId,
      user_id: userId,
      added_by: addedBy,
      enabled: true,
      bot_deafened: existing?.bot_deafened ?? false,
      created_at: existing?.created_at ?? new Date(),
    });
    return true;
  }

  /**
   * Take a user off the list. If we currently have them server-deafened we
   * lift it now; if they're out of voice (so we can't), the row is kept
   * disabled and the deafen is lifted the next time they join.
   */
  async remove(guildId: string, userId: string, voiceState: VoiceState | null): Promise<RemoveResult> {
    const entry = this.get(guildId, userId);
    if (!entry || !entry.enabled) return 'not-found';

    if (!entry.bot_deafened) {
      await this.deleteRow(guildId, userId);
      return 'removed';
    }

    entry.enabled = false;
    await this.db.execute(
      'UPDATE deafensync_users SET enabled = FALSE WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );

    if (voiceState?.channelId) {
      await this.sync(voiceState);
      return 'released';
    }
    return 'pending-release';
  }

  private async deleteRow(guildId: string, userId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM deafensync_users WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    this.deleteCached(guildId, userId);
  }

  private async setBotDeafened(entry: SyncedUser, value: boolean): Promise<void> {
    entry.bot_deafened = value;
    await this.db.execute(
      'UPDATE deafensync_users SET bot_deafened = ? WHERE guild_id = ? AND user_id = ?',
      [value, entry.guild_id, entry.user_id]
    );
  }

  // ==================== Sync ====================

  /**
   * Bring a user's server deafen in line with their client deafen.
   * Safe to call on every voice state update — it's a no-op when already in sync.
   */
  sync(state: VoiceState): Promise<void> {
    const key = `${state.guild.id}:${state.id}`;
    const prev = this.locks.get(key) ?? Promise.resolve();
    const next = prev.then(() => this.syncNow(state)).catch((error) => {
      logger.error(`Failed to sync deafen for user ${state.id} in guild ${state.guild.id}:`, error);
    });
    this.locks.set(key, next);
    void next.finally(() => {
      if (this.locks.get(key) === next) this.locks.delete(key);
    });
    return next;
  }

  private async syncNow(staleState: VoiceState): Promise<void> {
    const guild = staleState.guild;
    const entry = this.get(guild.id, staleState.id);
    if (!entry) return;

    // Queued calls may be holding an older snapshot — always act on the latest state
    const state = guild.voiceStates.cache.get(staleState.id) ?? staleState;
    if (!state.channelId) return; // Can't change deafen for someone not in voice

    const selfDeaf = !!state.selfDeaf;
    const serverDeaf = !!state.serverDeaf;

    // Client deafened -> server deafen
    if (entry.enabled && selfDeaf && !serverDeaf) {
      await state.setDeaf(true, 'Deafen Sync: client deafened');
      await this.setBotDeafened(entry, true);
      logger.debug(`Server-deafened ${state.id} in ${guild.name}`);
      return;
    }

    // Client undeafened (or user removed from list) -> lift our server deafen.
    // Server deafens applied by someone else are left alone.
    if ((!selfDeaf || !entry.enabled) && serverDeaf && entry.bot_deafened) {
      await state.setDeaf(false, 'Deafen Sync: client undeafened');
      if (entry.enabled) {
        await this.setBotDeafened(entry, false);
      } else {
        await this.deleteRow(guild.id, state.id);
      }
      logger.debug(`Server-undeafened ${state.id} in ${guild.name}`);
      return;
    }

    // Someone else lifted the server deafen — it's no longer ours to manage
    if (!serverDeaf && entry.bot_deafened) {
      if (entry.enabled) {
        await this.setBotDeafened(entry, false);
      } else {
        await this.deleteRow(guild.id, state.id);
      }
    }
  }

  /** Reconcile everyone on the list who's currently in voice (e.g. after a restart). */
  async syncAll(client: Client): Promise<void> {
    for (const [guildId, users] of this.cache) {
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      for (const userId of users.keys()) {
        const state = guild.voiceStates.cache.get(userId);
        if (state?.channelId) await this.sync(state);
      }
    }
  }
}
