import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('LeaderboardRegistry');

/**
 * A single entry in a leaderboard
 */
export interface LeaderboardEntry {
  /** User ID */
  userId: string;
  /** The value to display (points, seconds, count, etc.) */
  value: number;
  /** Optional secondary value (e.g., lifetime vs current) */
  secondaryValue?: number;
}

/**
 * Result from getting a user's rank
 */
export interface UserRankInfo {
  /** User's rank (1-indexed) */
  rank: number;
  /** User's value */
  value: number;
  /** Optional secondary value */
  secondaryValue?: number;
}

/**
 * Provider interface - modules implement this to provide leaderboard data
 */
export interface LeaderboardProvider {
  /**
   * Get leaderboard entries for a guild
   * @param guildId The guild to get entries for
   * @param limit Maximum number of entries to return
   * @param offset Offset for pagination
   */
  getEntries(guildId: string, limit: number, offset: number): Promise<LeaderboardEntry[]>;

  /**
   * Get a user's rank in the leaderboard
   * @param userId The user to get rank for
   * @param guildId The guild
   */
  getUserRank(userId: string, guildId: string): Promise<UserRankInfo | null>;

  /**
   * Get total number of users on this leaderboard
   * @param guildId The guild
   */
  getTotalUsers(guildId: string): Promise<number>;
}

/**
 * Configuration for a registered leaderboard
 */
export interface LeaderboardConfig {
  /** Unique identifier for this leaderboard */
  id: string;

  /** Display name shown in UI */
  name: string;

  /** Description of what this leaderboard tracks */
  description: string;

  /** Emoji to show next to the name */
  emoji: string;

  /** Module that owns this leaderboard */
  moduleId: string;

  /** Unit name for the value (e.g., "points", "seconds", "messages") */
  unit: string;

  /** Function to format the value for display */
  formatValue: (value: number) => string;

  /** Optional function to format the secondary value for display */
  formatSecondaryValue?: (value: number) => string;

  /** The provider that supplies data */
  provider: LeaderboardProvider;

  /** Whether this leaderboard has sub-types (e.g., balance vs lifetime) */
  hasSubTypes?: boolean;

  /** Sub-type definitions if hasSubTypes is true */
  subTypes?: LeaderboardSubType[];
}

/**
 * Sub-type for leaderboards with multiple views (e.g., points balance vs lifetime)
 */
export interface LeaderboardSubType {
  /** Unique identifier within this leaderboard */
  id: string;

  /** Display name */
  name: string;

  /** Whether to use secondaryValue from entries */
  useSecondaryValue?: boolean;
}

/**
 * Registered leaderboard with all metadata
 */
export interface RegisteredLeaderboard extends LeaderboardConfig {
  /** When this leaderboard was registered */
  registeredAt: Date;
}

/**
 * Central registry for leaderboards.
 * Modules register their leaderboard providers here.
 */
export class LeaderboardRegistry {
  private leaderboards: Map<string, RegisteredLeaderboard> = new Map();

  /**
   * Register a leaderboard
   */
  register(config: LeaderboardConfig): void {
    if (this.leaderboards.has(config.id)) {
      logger.warn(`Leaderboard ${config.id} already registered, replacing`);
    }

    this.leaderboards.set(config.id, {
      ...config,
      registeredAt: new Date(),
    });

    logger.debug(`Registered leaderboard: ${config.id} (${config.name})`);
  }

  /**
   * Unregister a leaderboard
   */
  unregister(id: string): void {
    if (this.leaderboards.delete(id)) {
      logger.debug(`Unregistered leaderboard: ${id}`);
    }
  }

  /**
   * Unregister all leaderboards from a module
   */
  unregisterByModule(moduleId: string): void {
    for (const [id, leaderboard] of this.leaderboards) {
      if (leaderboard.moduleId === moduleId) {
        this.leaderboards.delete(id);
        logger.debug(`Unregistered leaderboard: ${id} (module: ${moduleId})`);
      }
    }
  }

  /**
   * Get a registered leaderboard by ID
   */
  get(id: string): RegisteredLeaderboard | undefined {
    return this.leaderboards.get(id);
  }

  /**
   * Get all registered leaderboards
   */
  getAll(): RegisteredLeaderboard[] {
    return Array.from(this.leaderboards.values());
  }

  /**
   * Get leaderboards for display in select menu
   */
  getForSelectMenu(): { id: string; name: string; emoji: string; description: string }[] {
    return Array.from(this.leaderboards.values()).map((lb) => ({
      id: lb.id,
      name: lb.name,
      emoji: lb.emoji,
      description: lb.description,
    }));
  }

  /**
   * Check if a leaderboard exists
   */
  has(id: string): boolean {
    return this.leaderboards.has(id);
  }

  /**
   * Get count of registered leaderboards
   */
  get count(): number {
    return this.leaderboards.size;
  }
}

/**
 * Singleton instance
 */
export const leaderboardRegistry = new LeaderboardRegistry();

/**
 * Get the leaderboard registry instance
 */
export function getLeaderboardRegistry(): LeaderboardRegistry {
  return leaderboardRegistry;
}
