/**
 * Message Tracking Module - Tracks user message counts
 *
 * Features:
 * - Per-user message count in each guild
 * - Cooldown to prevent spam counting
 * - Daily message snapshots
 * - /messages command to check stats
 * - Leaderboard integration
 *
 * Events emitted:
 * - message-tracking:message-counted - When a message is counted
 */

import { MessageTrackingModule } from './module.js';

export default new MessageTrackingModule();
export { MessageTrackingModule };
export { MessageTrackingService } from './services/MessageTrackingService.js';
