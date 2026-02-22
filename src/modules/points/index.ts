/**
 * Points Module - Points and currency system
 *
 * Features:
 * - Per-user point balance in each guild
 * - Admin commands: give, take, set points
 * - User commands: balance, history
 * - Leaderboard with pagination
 * - Event integration for automatic point awards
 *
 * Events emitted:
 * - points:awarded - When points are added to a user
 * - points:removed - When points are removed from a user
 *
 * Events listened:
 * - voice-tracking:session-ended - Awards points for voice time
 */

import { PointsModule } from './module.js';

export default new PointsModule();
export { PointsModule };
export { PointsService } from './services/PointsService.js';
