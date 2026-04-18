import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';

// Hub menu command
import { command as gambleCommand, setStatsService as setGambleStats, setPointsService as setGamblePoints } from './commands/gamble.js';

// Individual game commands
import { command as coinflipCommand, setStatsService as setCoinflipStats, setPointsService as setCoinflipPoints } from './commands/coinflip.js';
import { command as slotsCommand, setStatsService as setSlotsStats, setPointsService as setSlotsPoints } from './commands/slots.js';
import { command as bjCommand, setStatsService as setBjStats, setBlackjackService as setBjBlackjack, setPointsService as setBjPoints } from './commands/blackjack.js';
import { command as rouletteCommand, setStatsService as setRouletteStats, setRouletteService as setRouletteSvc, setPointsService as setRoulettePoints } from './commands/roulette.js';
import { command as rpsCommand, setRPSService as setRpsRps, setPointsService as setRpsPoints } from './commands/rps.js';

// Event router
import {
  interactionCreateEvent,
  setStatsService as setEventStatsService,
  setBlackjackService as setEventBlackjackService,
  setRouletteService as setEventRouletteService,
  setRPSService as setEventRPSService,
  setPointsService as setEventPointsService,
} from './events/interactionCreate.js';
import { GamblingStatsService } from './services/GamblingStatsService.js';
import { BlackjackService } from './services/BlackjackService.js';
import { RouletteService } from './services/RouletteService.js';
import { RPSService } from './services/RPSService.js';
import { handleChoiceTimeout } from './events/handlers/rpsHandler.js';
import { createExpiredEmbed } from './games/rps.js';
import { PointsService } from '../points/services/PointsService.js';
import { Logger } from '../../shared/utils/logger.js';
import { getModuleSettingsService } from '../../core/settings/ModuleSettingsService.js';
import type { ModuleSettingsSchema } from '../../core/settings/SettingsDefinition.js';
import {
  getLeaderboardRegistry,
  LeaderboardProvider,
  LeaderboardEntry,
  UserRankInfo,
} from '../../core/leaderboards/LeaderboardRegistry.js';

const logger = new Logger('Gambling');

/**
 * Gambling module settings schema
 */
const GAMBLING_SETTINGS_SCHEMA: ModuleSettingsSchema = {
  moduleId: 'gambling',
  moduleName: 'Gambling',
  settings: [
    {
      key: 'min_bet',
      name: 'Minimum Bet',
      description: 'Minimum points required to place a bet',
      type: 'number',
      defaultValue: 10,
      min: 1,
      max: 10000,
      category: 'limits',
    },
    {
      key: 'max_bet',
      name: 'Maximum Bet',
      description: 'Maximum points allowed per bet (0 = no limit)',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 1000000,
      category: 'limits',
    },
    {
      key: 'cooldown_seconds',
      name: 'Cooldown (seconds)',
      description: 'Cooldown between gambling commands per user',
      type: 'number',
      defaultValue: 0,
      min: 0,
      max: 3600,
      category: 'limits',
    },
  ],
};

/**
 * Gambling settings interface
 */
export interface GamblingSettings extends Record<string, unknown> {
  min_bet: number;
  max_bet: number;
  cooldown_seconds: number;
}

/**
 * Gambling Module - Casino-style games using points
 *
 * Features:
 * - Coinflip (2x payout)
 * - Slots (variable payouts up to 50x)
 * - Roulette (various bet types, up to 36x)
 * - Blackjack (2x or 2.5x for natural blackjack)
 * - Per-user statistics and history
 * - Leaderboard integration
 *
 * Dependencies:
 * - points: Required for wagering and payouts
 */
export class GamblingModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'gambling',
    name: 'Gambling',
    description: 'Casino-style games using points',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: ['points'], // Requires points module for currency
    optionalDependencies: [],
    priority: 60, // Load after points module
  };

  readonly migrationsPath = './migrations';

  private statsService: GamblingStatsService | null = null;
  private blackjackService: BlackjackService | null = null;
  private rouletteService: RouletteService | null = null;
  private rpsService: RPSService | null = null;
  private pointsService: PointsService | null = null;

  constructor() {
    super();

    this.commands = [gambleCommand, coinflipCommand, slotsCommand, bjCommand, rouletteCommand, rpsCommand];
    this.events = [interactionCreateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Register settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.registerSchema(GAMBLING_SETTINGS_SCHEMA);
      logger.debug('Registered settings schema');
    }

    // Create services
    this.statsService = new GamblingStatsService(context.db, context.events);
    this.blackjackService = new BlackjackService(context.db);
    this.rouletteService = new RouletteService(context.db);
    this.rpsService = new RPSService(context.db);

    // Get points service from the points module
    this.pointsService = new PointsService(context.db, context.events);

    // Clear stale games from a previous bot session (refund bets)
    await this.clearStaleGamesOnStartup();

    // Inject services into hub menu
    setGambleStats(this.statsService);
    setGamblePoints(this.pointsService);

    // Inject services into individual commands
    setCoinflipStats(this.statsService);
    setCoinflipPoints(this.pointsService);
    setSlotsStats(this.statsService);
    setSlotsPoints(this.pointsService);
    setBjStats(this.statsService);
    setBjBlackjack(this.blackjackService);
    setBjPoints(this.pointsService);
    setRouletteStats(this.statsService);
    setRouletteSvc(this.rouletteService);
    setRoulettePoints(this.pointsService);
    setRpsRps(this.rpsService);
    setRpsPoints(this.pointsService);

    // Inject services into events
    setEventStatsService(this.statsService);
    setEventBlackjackService(this.blackjackService);
    setEventRouletteService(this.rouletteService);
    setEventRPSService(this.rpsService);
    setEventPointsService(this.pointsService);

    // Register leaderboard
    this.registerLeaderboard();

    // Start cleanup interval for expired games
    this.startCleanupInterval();

    logger.info('Gambling module loaded');
  }

  private registerLeaderboard(): void {
    if (!this.statsService) return;

    const service = this.statsService;

    // Net profit leaderboard
    const profitProvider: LeaderboardProvider = {
      async getEntries(guildId: string, limit: number, offset: number): Promise<LeaderboardEntry[]> {
        const entries = await service.getLeaderboard(guildId, limit, offset);
        return entries.map((e) => ({
          userId: e.user_id,
          value: e.net_profit,
          secondaryValue: e.total_bets,
        }));
      },

      async getUserRank(userId: string, guildId: string): Promise<UserRankInfo | null> {
        const stats = await service.getStats(userId, guildId);
        if (!stats || stats.total_bets === 0) return null;

        const rank = await service.getUserRank(userId, guildId);
        return {
          rank,
          value: stats.net_profit,
          secondaryValue: stats.total_bets,
        };
      },

      async getTotalUsers(guildId: string): Promise<number> {
        return service.getTotalUsers(guildId);
      },
    };

    getLeaderboardRegistry().register({
      id: 'gambling',
      name: 'Gambling',
      description: 'Net gambling profit',
      emoji: '🎰',
      moduleId: this.metadata.id,
      unit: 'points',
      formatValue: (value: number) => {
        const prefix = value >= 0 ? '+' : '';
        return `${prefix}**${value.toLocaleString()}** points`;
      },
      formatSecondaryValue: (value: number) => `${value.toLocaleString()} bets`,
      provider: profitProvider,
    });

    logger.debug('Registered gambling leaderboard');
  }

  private cleanupIntervalId: NodeJS.Timeout | null = null;

  private startCleanupInterval(): void {
    // Clean up expired games every minute, refunding bets before deleting
    this.cleanupIntervalId = setInterval(async () => {
      try {
        await this.cleanupBlackjackGames();
        await this.cleanupRouletteGames();
        await this.cleanupRPSChallenges();
      } catch (error) {
        logger.error('Error during game cleanup:', error);
      }
    }, 60000);
  }

  private async cleanupBlackjackGames(): Promise<void> {
    if (!this.blackjackService || !this.pointsService) return;

    const expiredGames = await this.blackjackService.getExpiredGames();
    for (const game of expiredGames) {
      // Refund the total bet (main + split) before deleting
      const totalBet = Number(game.bet_amount) + Number(game.split_bet_amount ?? 0);
      if (totalBet > 0) {
        await this.pointsService.addPoints(
          game.user_id, game.guild_id, totalBet,
          'Blackjack game expired - refund', 'other'
        );
        logger.debug(`Refunded ${totalBet} points to ${game.user_id} for expired blackjack game`);
      }
      await this.blackjackService.deleteGame(game.id);
    }
  }

  /**
   * On startup, clear ALL in-progress games left over from a previous bot session.
   * These games have no in-memory state (timers, session contexts) so they can never
   * complete normally. Refund all bets before deleting.
   */
  private async clearStaleGamesOnStartup(): Promise<void> {
    if (!this.blackjackService || !this.rouletteService || !this.pointsService) return;

    // ── Blackjack: refund and delete all unfinished games ──
    const bjGames = await this.blackjackService.getAllUnfinishedGames();
    for (const game of bjGames) {
      const totalBet = Number(game.bet_amount) + Number(game.split_bet_amount ?? 0);
      if (totalBet > 0) {
        await this.pointsService.addPoints(
          game.user_id, game.guild_id, totalBet,
          'Blackjack game cleared on restart - refund', 'other'
        );
      }
      await this.blackjackService.deleteGame(game.id);
    }
    if (bjGames.length > 0) {
      logger.info(`Cleared ${bjGames.length} stale blackjack game(s) on startup`);
    }

    // ── Roulette: refund all bets and delete all games ──
    const rouletteGames = await this.rouletteService.getAllGames();
    for (const game of rouletteGames) {
      const bets = await this.rouletteService.getAllBets(game.id);
      const userTotals = new Map<string, number>();

      for (const bet of bets) {
        userTotals.set(bet.user_id, (userTotals.get(bet.user_id) ?? 0) + Number(bet.bet_amount));
      }

      for (const [userId, total] of userTotals) {
        if (total > 0) {
          await this.pointsService.addPoints(
            userId, game.guild_id, total,
            'Roulette game cleared on restart - refund', 'other'
          );
        }
      }

      await this.rouletteService.deleteGame(game.id);
    }
    if (rouletteGames.length > 0) {
      logger.info(`Cleared ${rouletteGames.length} stale roulette game(s) on startup`);
    }
  }

  private async cleanupRouletteGames(): Promise<void> {
    if (!this.rouletteService || !this.pointsService) return;

    const expiredGames = await this.rouletteService.getExpiredGames();
    for (const game of expiredGames) {
      // Refund all bets grouped by user
      const bets = await this.rouletteService.getAllBets(game.id);
      const userTotals = new Map<string, number>();

      for (const bet of bets) {
        userTotals.set(bet.user_id, (userTotals.get(bet.user_id) ?? 0) + Number(bet.bet_amount));
      }

      for (const [userId, total] of userTotals) {
        if (total > 0) {
          await this.pointsService.addPoints(
            userId, game.guild_id, total,
            'Roulette game expired - refund', 'other'
          );
          logger.debug(`Refunded ${total} points to ${userId} for expired roulette game`);
        }
      }

      await this.rouletteService.deleteGame(game.id);
    }
  }

  private async cleanupRPSChallenges(): Promise<void> {
    if (!this.rpsService || !this.pointsService || !this.statsService) return;

    // Cleanup expired pending challenges (opponent didn't accept in time)
    const expiredPending = await this.rpsService.getExpiredPendingChallenges();
    for (const challenge of expiredPending) {
      // Refund challenger
      await this.pointsService.addPoints(
        challenge.challenger_id, challenge.guild_id, challenge.bet_amount,
        'RPS challenge expired - refund', 'other'
      );
      await this.rpsService.expireChallenge(challenge.id);
      logger.debug(`Expired RPS challenge ${challenge.id}, refunded ${challenge.bet_amount} to ${challenge.challenger_id}`);

      // Try to update the message
      try {
        const channel = await this.client.channels.fetch(challenge.channel_id);
        if (channel && 'messages' in channel && challenge.message_id) {
          const message = await channel.messages.fetch(challenge.message_id);
          const embed = createExpiredEmbed(challenge.challenger_id, challenge.opponent_id, challenge.bet_amount);
          await message.edit({ embeds: [embed], components: [] });
        }
      } catch { /* message may be deleted */ }
    }

    // Cleanup expired accepted challenges (choice deadline passed — backup for in-memory timers)
    const expiredAccepted = await this.rpsService.getExpiredAcceptedChallenges();
    for (const challenge of expiredAccepted) {
      await handleChoiceTimeout(challenge.id, this.rpsService, this.statsService, this.pointsService, this.client);
    }
  }

  async onUnload(): Promise<void> {
    // Stop cleanup interval
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }

    // Unregister settings schema
    const settingsService = getModuleSettingsService();
    if (settingsService) {
      settingsService.unregisterSchema(this.metadata.id);
    }

    // Unregister leaderboard
    getLeaderboardRegistry().unregister('gambling');

    // Clear RPS choice timers
    if (this.rpsService) {
      this.rpsService.clearAllTimers();
    }

    this.statsService = null;
    this.blackjackService = null;
    this.rouletteService = null;
    this.rpsService = null;
    this.pointsService = null;

    await super.onUnload();
    logger.info('Gambling module unloaded');
  }

  /**
   * Get the stats service for external use
   */
  getStatsService(): GamblingStatsService | null {
    return this.statsService;
  }

  /**
   * Get the blackjack service for external use
   */
  getBlackjackService(): BlackjackService | null {
    return this.blackjackService;
  }

  /**
   * Get the roulette service for external use
   */
  getRouletteService(): RouletteService | null {
    return this.rouletteService;
  }

  /**
   * Get the RPS service for external use
   */
  getRPSService(): RPSService | null {
    return this.rpsService;
  }
}
