/**
 * Leaderboard Sync Service
 * Periodically syncs leaderboard data from the bot to the website
 * Uses the LeaderboardRegistry to dynamically gather data from all registered modules
 */

import { Logger } from '../../../shared/utils/logger.js';
import { getLeaderboardRegistry } from '../../../core/leaderboards/LeaderboardRegistry.js';
import { WebsiteApiService } from './WebsiteApiService.js';
import type {
  DynamicLeaderboardPayload,
  LeaderboardCategory,
  LeaderboardUser,
} from '../types/website.types.js';
import type { PrismaClient } from '@prisma/client';

const logger = new Logger('WebsiteIntegration:Leaderboard');

interface LeaderboardSyncConfig {
  syncInterval: number; // milliseconds
  topUsersLimit: number;
}

const DEFAULT_CONFIG: LeaderboardSyncConfig = {
  syncInterval: 10 * 60 * 1000, // 10 minutes
  topUsersLimit: 50,
};

export class LeaderboardSync {
  private timer: NodeJS.Timeout | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private config: LeaderboardSyncConfig;
  private secret: string;
  private guildId: string;
  private apiService: WebsiteApiService;
  private prisma: PrismaClient;
  private isRunning = false;
  private lastSyncTime: Date | null = null;
  private isPaused = false; // Paused due to errors
  private consecutiveFailures = 0;
  private recoveryAttempts = 0;
  private readonly MAX_FAILURES = 3;
  private readonly BASE_RECOVERY_DELAY = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_RECOVERY_DELAY = 30 * 60 * 1000; // 30 minutes

  constructor(
    apiService: WebsiteApiService,
    prisma: PrismaClient,
    guildId: string,
    secret: string,
    config?: Partial<LeaderboardSyncConfig>
  ) {
    this.apiService = apiService;
    this.prisma = prisma;
    this.guildId = guildId;
    this.secret = secret;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(secret: string, syncInterval?: number): void {
    this.secret = secret;
    if (syncInterval !== undefined) {
      this.config.syncInterval = syncInterval * 60 * 1000; // Convert minutes to ms

      // Restart timer if running
      if (this.isRunning) {
        this.stop();
        this.start();
      }
    }
  }

  /**
   * Start periodic sync
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.scheduleSync();
    logger.info(`Leaderboard sync started (interval: ${this.config.syncInterval / 60000} minutes)`);

    // Do initial sync immediately
    this.sync().catch(err => logger.error('Initial leaderboard sync failed:', err));
  }

  /**
   * Stop periodic sync
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.isRunning = false;
    this.isPaused = false;
    this.recoveryAttempts = 0;
    logger.info('Leaderboard sync stopped');
  }

  /**
   * Get last sync time
   */
  getLastSyncTime(): Date | null {
    return this.lastSyncTime;
  }

  /**
   * Force sync now
   */
  async sync(): Promise<boolean> {
    try {
      // Gather data from all registered leaderboards
      const { categories, users } = await this.gatherLeaderboardData();

      if (categories.length === 0) {
        logger.warn('No leaderboard categories registered');
        return true;
      }

      if (users.length === 0) {
        logger.warn('No leaderboard users to sync');
        return true;
      }

      // Build the dynamic payload (secret is sent via Authorization header)
      const payload: DynamicLeaderboardPayload = {
        categories,
        users,
        lastUpdated: new Date().toISOString(),
      };

      const response = await this.apiService.sendLeaderboard(payload);

      if (response.success) {
        this.lastSyncTime = new Date();
        this.consecutiveFailures = 0;
        logger.info(`Synced ${users.length} users across ${categories.length} categories to website`);
        return true;
      } else {
        logger.error(`Failed to sync leaderboard: ${response.error}`);
        this.handleFailure();
        return false;
      }
    } catch (error) {
      logger.error('Error during leaderboard sync:', error);
      this.handleFailure();
      return false;
    }
  }

  /**
   * Handle a failure - pause after too many consecutive failures, then schedule recovery
   */
  private handleFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.MAX_FAILURES) {
      this.isPaused = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.isRunning = false;
      this.scheduleRecovery();
    }
  }

  /**
   * Schedule a recovery attempt with exponential backoff
   */
  private scheduleRecovery(): void {
    // Calculate delay with exponential backoff: 5min, 10min, 15min, 20min, 25min, 30min (max)
    const delay = Math.min(
      this.BASE_RECOVERY_DELAY * (this.recoveryAttempts + 1),
      this.MAX_RECOVERY_DELAY
    );
    this.recoveryAttempts++;

    const delayMinutes = Math.round(delay / 60000);
    logger.warn(`Leaderboard sync paused. Scheduling recovery attempt #${this.recoveryAttempts} in ${delayMinutes} minutes...`);

    this.recoveryTimer = setTimeout(() => {
      this.attemptRecovery();
    }, delay);
  }

  /**
   * Attempt to recover from paused state
   */
  private async attemptRecovery(): Promise<void> {
    logger.info(`Leaderboard sync attempting recovery (attempt #${this.recoveryAttempts})...`);

    // Reset failure count and try syncing
    this.consecutiveFailures = 0;
    this.isPaused = false;
    this.isRunning = true;

    const success = await this.sync();

    // If successful, resume normal operation
    if (success && this.isRunning && !this.isPaused) {
      logger.info('Leaderboard sync recovered successfully!');
      this.recoveryAttempts = 0;
      this.scheduleSync();
    }
    // If we failed again, handleFailure() will have scheduled another recovery
  }

  /**
   * Check if paused due to errors
   */
  isPausedDueToError(): boolean {
    return this.isPaused;
  }

  /**
   * Schedule the next sync
   */
  private scheduleSync(): void {
    if (!this.isRunning) return;

    this.timer = setTimeout(async () => {
      await this.sync();
      this.scheduleSync();
    }, this.config.syncInterval);
  }

  /**
   * Gather leaderboard data from all registered modules via the registry
   */
  private async gatherLeaderboardData(): Promise<{ categories: LeaderboardCategory[]; users: LeaderboardUser[] }> {
    const registry = getLeaderboardRegistry();
    const registeredLeaderboards = registry.getAll();

    if (registeredLeaderboards.length === 0) {
      return { categories: [], users: [] };
    }

    // Build categories from registry
    const categories: LeaderboardCategory[] = registeredLeaderboards.map(lb => ({
      id: lb.id,
      name: lb.name,
      description: lb.description,
      emoji: lb.emoji,
      unit: lb.unit,
      moduleId: lb.moduleId,
      hasSecondaryValue: lb.formatSecondaryValue !== undefined,
    }));

    // Get user info from Prisma for avatar/username lookup
    const guildUsers = await this.prisma.user.findMany({
      where: {
        guildMembers: {
          some: { guildId: this.guildId },
        },
      },
      select: {
        id: true,
        username: true,
        avatarHash: true,
      },
    });

    const userInfoMap = new Map<string, { username: string; avatar: string }>();
    for (const user of guildUsers) {
      const avatarUrl = user.avatarHash
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatarHash}.png?size=128`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.id) % 5}.png`;

      userInfoMap.set(user.id, {
        username: user.username,
        avatar: avatarUrl,
      });
    }

    // Gather data from each leaderboard provider
    const userValuesMap = new Map<string, Record<string, { value: number; secondaryValue?: number }>>();

    for (const leaderboard of registeredLeaderboards) {
      try {
        const entries = await leaderboard.provider.getEntries(
          this.guildId,
          this.config.topUsersLimit,
          0
        );

        for (const entry of entries) {
          // Only include users we know about (in the guild)
          if (!userInfoMap.has(entry.userId)) continue;

          if (!userValuesMap.has(entry.userId)) {
            userValuesMap.set(entry.userId, {});
          }

          const userValues = userValuesMap.get(entry.userId)!;
          userValues[leaderboard.id] = {
            value: entry.value,
            ...(entry.secondaryValue !== undefined && { secondaryValue: entry.secondaryValue }),
          };
        }
      } catch (error) {
        logger.warn(`Failed to get entries from leaderboard ${leaderboard.id}:`, error);
      }
    }

    // Build the users array
    const users: LeaderboardUser[] = [];
    for (const [userId, values] of userValuesMap) {
      const userInfo = userInfoMap.get(userId);
      if (!userInfo) continue;

      users.push({
        discordId: userId,
        username: userInfo.username,
        avatar: userInfo.avatar,
        values,
      });
    }

    // Sort users by the first category's value (if any) for consistent ordering
    const primaryCategory = categories[0];
    if (primaryCategory) {
      const primaryCategoryId = primaryCategory.id;
      users.sort((a, b) => {
        const aValue = a.values[primaryCategoryId]?.value ?? 0;
        const bValue = b.values[primaryCategoryId]?.value ?? 0;
        return bValue - aValue;
      });
    }

    // Limit to top N users
    return { categories, users: users.slice(0, this.config.topUsersLimit) };
  }
}
