/**
 * Re-exports for backwards compatibility during migration.
 *
 * New code should import types from '../types.js' and use the
 * individual services: GamblingStatsService, BlackjackService, RouletteService.
 */

// Re-export all types from the shared types file
export type {
  GameType,
  GameOutcome,
  GamblingStats,
  GamblingHistory,
  GameResult,
  Card,
  HandStatus,
  CurrentHand,
  BlackjackGame,
  RouletteGame,
  RouletteBet,
} from '../types.js';

// Re-export services
export { GamblingStatsService } from './GamblingStatsService.js';
export { BlackjackService } from './BlackjackService.js';
export { RouletteService } from './RouletteService.js';
