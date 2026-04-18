import {
  ChannelType,
  ForumChannel,
  PermissionFlagsBits,
  OverwriteType,
  ThreadChannel,
} from 'discord.js';
import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { interactionCreateEvent, setService as setInteractionService } from './events/interactionCreate.js';
import { messageCreateEvent, setService as setMessageService } from './events/messageCreate.js';
import {
  HumorCompetitionService,
  GuildSettings,
  Submission,
  KING_ROLE_RETENTION_DAYS,
  DAILY_HOUR_ET,
  FORUM_CHANNEL_NAME,
  TRUSTED_ROLE_NAME,
  WINNER_ROLE_NAME,
  getCurrentEasternHour,
  getTodaysDateLabel,
  getThreadName,
} from './services/HumorCompetitionService.js';
import { HumorPanel } from './components/HumorPanel.js';
import { DatabaseService } from '../../core/database/postgres.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';
import { Logger } from '../../shared/utils/logger.js';

interface HumorSettings extends Record<string, unknown> {
  announce_channel_id: string | null;
}

const HUMOR_SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'humor-competition',
  moduleName: 'Humor Competition',
  settings: [
    {
      key: 'announce_channel_id',
      name: 'Announcement Channel',
      description: 'Channel where source image and winner announcements are cross-posted (defaults to #general)',
      type: 'channel',
      defaultValue: null,
      category: 'general',
    },
  ],
};

const logger = new Logger('HumorCompetition');

let globalService: HumorCompetitionService | null = null;

export function getHumorCompetitionService(): HumorCompetitionService | null {
  return globalService;
}

/**
 * Humor Competition Module - Daily AI Picture Competition
 *
 * Zero-config, channel-name-driven:
 * - Auto-creates forum channel and roles
 * - At 3 AM ET: ends previous day's competition (picks winner or tie-break),
 *   then creates the next day's forum post
 * - On startup: ensures today's post exists (catches up if bot was offline)
 * - DB is a lightweight index (thread IDs, submissions, winners) — not the source of truth for "is active"
 * - Competition state is derived from: does thread exist + does it have a winner record
 */
export class HumorCompetitionModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'humor-competition',
    name: 'Humor Competition',
    description: 'Daily AI picture humor competition - King of Humor',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: ['points'],
    priority: 50,
  };

  readonly migrationsPath = 'migrations';

  private service: HumorCompetitionService | null = null;
  private tickInterval: NodeJS.Timeout | null = null;
  private dailyJobRan: Set<string> = new Set();

  constructor() {
    super();
    this.events = [interactionCreateEvent, messageCreateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    const dbService = new DatabaseService();
    this.service = new HumorCompetitionService(dbService);
    globalService = this.service;

    setInteractionService(this.service);
    setMessageService(this.service);

    // Register settings schema with the centralized settings system
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(HUMOR_SETTINGS_SCHEMA);
    }

    this.startTickLoop();
    logger.info('Humor Competition module loaded');
  }

  async onEnable(guildId: string): Promise<void> {
    logger.debug(`Humor Competition enabled for guild ${guildId}`);
  }

  async onDisable(guildId: string): Promise<void> {
    logger.debug(`Humor Competition disabled for guild ${guildId}`);
  }

  async onUnload(): Promise<void> {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    globalService = null;
    this.service = null;
    this.dailyJobRan.clear();
    logger.info('Humor Competition module unloaded');
  }

  // ==================== Auto-Setup ====================

  private async autoSetup(guildId: string): Promise<void> {
    if (!this.service || !this.context) return;

    const guild = await this.context.client.guilds.fetch(guildId);

    let trustedRole = guild.roles.cache.find(r => r.name === TRUSTED_ROLE_NAME);
    if (!trustedRole) {
      trustedRole = await guild.roles.create({
        name: TRUSTED_ROLE_NAME,
        reason: 'Humor Competition - manages daily competitions',
        mentionable: false,
      });
      logger.info(`Created "${TRUSTED_ROLE_NAME}" role in ${guild.name}`);
    }

    let winnerRole = guild.roles.cache.find(r => r.name === WINNER_ROLE_NAME);
    if (!winnerRole) {
      winnerRole = await guild.roles.create({
        name: WINNER_ROLE_NAME,
        color: 0xFFD700,
        hoist: true,
        reason: 'Humor Competition - awarded to daily winners',
        mentionable: false,
      });
      logger.info(`Created "${WINNER_ROLE_NAME}" role in ${guild.name}`);
    }

    let forumChannel = guild.channels.cache.find(
      c => c.type === ChannelType.GuildForum && c.name === FORUM_CHANNEL_NAME
    ) as ForumChannel | undefined;

    if (!forumChannel) {
      forumChannel = await guild.channels.create({
        name: FORUM_CHANNEL_NAME,
        type: ChannelType.GuildForum,
        reason: 'Humor Competition - daily humor competition forum',
        topic: 'Daily AI Humor Competition — post your funniest AI-generated images and vote for the King of Humor!',
        permissionOverwrites: [
          {
            id: trustedRole.id,
            type: OverwriteType.Role,
            allow: [PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ManageThreads],
          },
        ],
      });
      logger.info(`Created "${FORUM_CHANNEL_NAME}" forum in ${guild.name}`);
    } else {
      await forumChannel.permissionOverwrites.create(trustedRole, {
        ManageMessages: true,
        ManageThreads: true,
      });
    }

    // Find the general chat by name for announcements
    const generalChannel = guild.channels.cache.find(
      c => c.type === ChannelType.GuildText && c.name === 'general'
    );
    const announceChannelId = generalChannel?.id ?? null;

    await this.service.saveSetupIds(guildId, forumChannel.id, trustedRole.id, winnerRole.id, announceChannelId);
    logger.info(`Auto-setup complete for guild ${guild.name} (announce channel: ${announceChannelId ?? 'none'})`);
  }

  // ==================== Background Tick ====================

  private startTickLoop(): void {
    this.runTick();
    this.tickInterval = setInterval(() => this.runTick(), 60_000);
  }

  private async runTick(): Promise<void> {
    if (!this.service || !this.context) return;
    if (!this.context.client.isReady()) return;

    try {
      await this.ensureAllGuildsSetUp();
      await this.runDailyJobs();
      await this.ensureTodaysPost();
    } catch (error) {
      logger.error('Error in tick loop:', error);
    }
  }

  private async ensureAllGuildsSetUp(): Promise<void> {
    if (!this.service || !this.context) return;

    for (const [guildId] of this.context.client.guilds.cache) {
      try {
        const settings = await this.service.getGuildSettings(guildId);
        if (!settings?.setup_complete) {
          logger.info(`Running auto-setup for guild ${guildId}...`);
          await this.autoSetup(guildId);
          continue;
        }

        // Backfill missing announce channel for guilds that were set up
        // before the announce_channel_id column existed
        if (!settings.announce_channel_id) {
          const guild = await this.context.client.guilds.fetch(guildId);
          const generalChannel = guild.channels.cache.find(
            c => c.type === ChannelType.GuildText && c.name === 'general'
          );
          if (generalChannel) {
            await this.service.setAnnounceChannel(guildId, generalChannel.id);
            logger.info(`Backfilled announce channel for guild ${guild.name}: #${generalChannel.name}`);
          } else {
            logger.debug(`No "general" channel found in guild ${guild.name} for announce backfill`);
          }
        }
      } catch (error) {
        logger.error(`Error in auto-setup for guild ${guildId}:`, error);
      }
    }
  }

  /**
   * At 3 AM ET: end yesterday's competition, clean up unused threads, check role expiry.
   * Only runs once per day per guild.
   */
  private async runDailyJobs(): Promise<void> {
    if (!this.service || !this.context) return;

    const easternHour = getCurrentEasternHour();

    // Reset daily tracking at midnight ET
    if (easternHour === 0) {
      this.dailyJobRan.clear();
    }

    if (easternHour < DAILY_HOUR_ET) return;

    const guilds = await this.service.getAllSetupGuilds();

    for (const settings of guilds) {
      if (this.dailyJobRan.has(settings.guild_id)) continue;

      try {
        await this.endYesterdaysCompetition(settings);
        await this.cleanupUnusedThread(settings);
        await this.checkKingRoleExpiry(settings);
        this.dailyJobRan.add(settings.guild_id);
      } catch (error) {
        logger.error(`Error in daily jobs for guild ${settings.guild_id}:`, error);
      }
    }
  }

  /**
   * Ensure today's forum post exists. Runs every tick (idempotent).
   * If today's post is missing, create it.
   */
  private async ensureTodaysPost(): Promise<void> {
    if (!this.service || !this.context) return;

    const todaysLabel = getTodaysDateLabel();
    const guilds = await this.service.getAllSetupGuilds();

    for (const settings of guilds) {
      try {
        const existing = await this.service.getThreadByDateLabel(settings.guild_id, todaysLabel);
        if (existing) continue;

        await this.createDailyForumPost(settings, todaysLabel);
      } catch (error) {
        logger.error(`Error ensuring today's post for guild ${settings.guild_id}:`, error);
      }
    }
  }

  // ==================== Daily Jobs ====================

  /**
   * End yesterday's competition: tally votes, pick winner (or post tie-breaker).
   */
  private async endYesterdaysCompetition(settings: GuildSettings): Promise<void> {
    if (!this.service || !this.context) return;

    const yesterday = await this.service.getYesterdaysThread(settings.guild_id);
    if (!yesterday) return;

    // Already has a winner
    const existingWinner = await this.service.getWinnerByThread(yesterday.thread_id);
    if (existingWinner) return;

    const submissions = await this.service.getSubmissions(yesterday.thread_id);
    if (submissions.length === 0) return; // No submissions — cleanup will handle the empty thread

    // Tally reactions
    await this.tallyReactionsFromThread(yesterday.thread_id, submissions);
    const finalSubmissions = await this.service.getSubmissions(yesterday.thread_id);

    // Disable the panel
    if (yesterday.panel_message_id) {
      try {
        const thread = await this.context.client.channels.fetch(yesterday.thread_id);
        if (thread && thread.isThread()) {
          const panelMsg = await (thread as ThreadChannel).messages.fetch(yesterday.panel_message_id);
          await panelMsg.edit({ components: HumorPanel.createDisabledButtons() });
        }
      } catch { /* ignore */ }
    }

    const result = resolveWinner(finalSubmissions);

    try {
      const thread = await this.context.client.channels.fetch(yesterday.thread_id);
      if (!thread || !thread.isThread()) return;
      const tc = thread as ThreadChannel;

      if (result.type === 'winner') {
        const winner = result.winner!;
        await this.service.recordWinner(settings.guild_id, yesterday.thread_id, winner.user_id, winner.id, winner.vote_count);

        await tc.send({
          embeds: [HumorPanel.createWinnerEmbed(winner, finalSubmissions.length)],
        });

        if (settings.winner_role_id) {
          await this.assignWinnerRole(settings.guild_id, winner.user_id, settings.winner_role_id);
        }

        this.context.events.emitAsync('humor:winner-crowned', this.metadata.id, {
          guildId: settings.guild_id,
          threadId: yesterday.thread_id,
          winnerId: winner.user_id,
          voteCount: winner.vote_count,
          totalSubmissions: finalSubmissions.length,
        });

        // Announce winner in the general/announce channel
        await this.announceWinnerInGeneral(settings, winner, finalSubmissions.length, yesterday.thread_id);
      } else if (result.type === 'tie') {
        // Resolve display names for the dropdown
        const displayNames = new Map<string, string>();
        const guild = await this.context.client.guilds.fetch(settings.guild_id);
        for (const s of result.tied!) {
          try {
            const member = await guild.members.fetch(s.user_id);
            displayNames.set(s.user_id, member.displayName);
          } catch {
            displayNames.set(s.user_id, s.user_id);
          }
        }

        // Post tie-breaker dropdown for managers
        await tc.send({
          embeds: [HumorPanel.createTieBreakerEmbed(result.tied!)],
          components: HumorPanel.createTieBreakerSelect(yesterday.thread_id, result.tied!, displayNames),
        });
        logger.info(`Tie in thread ${yesterday.thread_id} — waiting for manager to pick winner`);
      } else {
        await tc.send({
          embeds: [HumorPanel.createNoWinnerEmbed('No votes were cast.')],
        });
      }
    } catch (error) {
      logger.error(`Error announcing result for thread ${yesterday.thread_id}:`, error);
    }
  }

  /**
   * Delete yesterday's thread if it had zero submissions.
   */
  private async cleanupUnusedThread(settings: GuildSettings): Promise<void> {
    if (!this.service || !this.context) return;

    const yesterday = await this.service.getYesterdaysThread(settings.guild_id);
    if (!yesterday) return;

    const count = await this.service.getSubmissionCount(yesterday.thread_id);
    if (count > 0) return;

    try {
      const thread = await this.context.client.channels.fetch(yesterday.thread_id);
      if (thread && thread.isThread()) {
        await thread.delete('No submissions - cleaning up unused competition post');
        logger.info(`Deleted unused competition post for guild ${settings.guild_id}`);
      }
    } catch {
      logger.debug(`Could not delete yesterday's thread for guild ${settings.guild_id}`);
    }

    await this.service.deleteThreadIndex(yesterday.thread_id);
  }

  private async checkKingRoleExpiry(settings: GuildSettings): Promise<void> {
    if (!this.service || !this.context || !settings.winner_role_id) return;

    try {
      const guild = await this.context.client.guilds.fetch(settings.guild_id);
      const role = await guild.roles.fetch(settings.winner_role_id);
      if (!role) return;

      const expiryThreshold = new Date(Date.now() - KING_ROLE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

      for (const [, member] of role.members) {
        const latestWin = await this.service.getLatestWinDate(settings.guild_id, member.id);
        if (!latestWin || new Date(latestWin) < expiryThreshold) {
          try {
            await member.roles.remove(settings.winner_role_id);
            logger.info(`Removed expired King of Humor role from ${member.user.username}`);
          } catch {
            logger.debug(`Could not remove king role from ${member.id}`);
          }
        }
      }
    } catch (error) {
      logger.error(`Error checking king role expiry for guild ${settings.guild_id}:`, error);
    }
  }

  // ==================== Forum Post Creation ====================

  private async createDailyForumPost(settings: GuildSettings, dateLabel: string): Promise<void> {
    if (!this.service || !this.context || !settings.forum_channel_id) return;

    try {
      const channel = await this.context.client.channels.fetch(settings.forum_channel_id);
      if (!channel || channel.type !== ChannelType.GuildForum) {
        logger.debug(`Forum channel not found for guild ${settings.guild_id}, re-running setup`);
        await this.autoSetup(settings.guild_id);
        return;
      }

      const forumChannel = channel as ForumChannel;
      const threadName = getThreadName(dateLabel);

      const panelEmbed = HumorPanel.createWaitingPanel(0);
      const panelButtons = HumorPanel.createManagementButtons('placeholder');

      const thread = await forumChannel.threads.create({
        name: threadName,
        message: {
          embeds: [panelEmbed],
          components: panelButtons,
        },
        reason: 'Daily humor competition',
      });

      // Save to index
      await this.service.saveThreadIndex(settings.guild_id, thread.id, dateLabel);

      // Update the placeholder button IDs with the real thread ID
      const starterMessage = await thread.fetchStarterMessage();
      if (starterMessage) {
        await this.service.setPanelMessageId(thread.id, starterMessage.id);
        await starterMessage.edit({
          embeds: [panelEmbed],
          components: HumorPanel.createManagementButtons(thread.id),
        });
      }

      logger.info(`Daily humor post created for guild ${settings.guild_id}: ${threadName}`);
    } catch (error) {
      logger.error(`Error creating daily forum post for guild ${settings.guild_id}:`, error);
    }
  }

  // ==================== Helpers ====================

  private async tallyReactionsFromThread(
    threadId: string,
    submissions: Submission[]
  ): Promise<void> {
    if (!this.service || !this.context) return;

    try {
      const thread = await this.context.client.channels.fetch(threadId);
      if (!thread || !thread.isThread()) return;

      for (const submission of submissions) {
        try {
          const msg = await (thread as ThreadChannel).messages.fetch(submission.message_id);
          const thumbsUp = msg.reactions.cache.get('👍');

          if (thumbsUp) {
            const users = await thumbsUp.users.fetch();
            let count = 0;
            for (const [userId] of users) {
              if (userId === this.context.client.user?.id) continue;
              if (userId === submission.user_id) continue;
              count++;
            }
            await this.service.updateSubmissionVoteCount(submission.id, count);
          }
        } catch {
          logger.debug(`Could not fetch reactions for submission ${submission.id}`);
        }
      }
    } catch (error) {
      logger.error(`Error tallying reactions in thread ${threadId}:`, error);
    }
  }

  /**
   * Post the winner announcement to the configured announce channel.
   */
  /**
   * Resolve the announce channel ID for a guild.
   * Prefers the value set via /settings, falls back to the auto-detected one in guild_settings.
   */
  private async getAnnounceChannelId(guildId: string, dbFallback: string | null): Promise<string | null> {
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      const userSettings = await settingsService.getSettings<HumorSettings>(this.metadata.id, guildId);
      if (userSettings.announce_channel_id) {
        return userSettings.announce_channel_id;
      }
    }
    return dbFallback;
  }

  private async announceWinnerInGeneral(
    settings: GuildSettings,
    winner: Submission,
    totalSubmissions: number,
    threadId: string
  ): Promise<void> {
    if (!this.context) return;

    const channelId = await this.getAnnounceChannelId(settings.guild_id, settings.announce_channel_id);
    if (!channelId) return;

    try {
      const channel = await this.context.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        await (channel as import('discord.js').TextChannel).send({
          embeds: [HumorPanel.createWinnerAnnouncement(winner, totalSubmissions, threadId)],
        });
      }
    } catch (error) {
      logger.debug('Could not post winner announcement to announce channel:', error);
    }
  }

  private async assignWinnerRole(guildId: string, winnerId: string, roleId: string): Promise<void> {
    if (!this.context) return;

    try {
      const guild = await this.context.client.guilds.fetch(guildId);
      const winnerMember = await guild.members.fetch(winnerId);
      if (winnerMember) {
        await winnerMember.roles.add(roleId);
        logger.info(`Assigned King of Humor role to ${winnerMember.user.username}`);
      }
    } catch (error) {
      logger.error('Error assigning winner role:', error);
    }
  }
}

// ==================== Shared Helper ====================

interface WinnerResult {
  type: 'winner' | 'tie' | 'none';
  winner?: Submission;
  tied?: Submission[];
}

function resolveWinner(submissions: Submission[]): WinnerResult {
  if (submissions.length === 0) return { type: 'none' };

  const maxVotes = Math.max(...submissions.map(s => s.vote_count));
  if (maxVotes < 1) return { type: 'none' };

  const topSubmissions = submissions.filter(s => s.vote_count === maxVotes);

  if (topSubmissions.length === 1) {
    return { type: 'winner', winner: topSubmissions[0] };
  }

  return { type: 'tie', tied: topSubmissions };
}
