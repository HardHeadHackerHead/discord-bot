/**
 * Website Integration Module
 *
 * Integrates the Discord bot with the Quad H Lab website.
 *
 * Features:
 * - Activity Feed: Sends real-time events (member join, voice join, boost, etc.) to website
 * - Leaderboard Sync: Periodically syncs XP/level/message/voice data to website
 * - Website Interactions: Polls for and posts website interactions (lab bell, wave, etc.)
 *
 * Configuration:
 * - Use /settings to configure website URL, secret, and channel
 * - Or set WEBSITE_URL and WEBSITE_WEBHOOK_SECRET environment variables
 *
 * Commands:
 * - /website status - View integration status
 * - /website sync - Force sync leaderboard now
 * - /website flush - Flush pending activity events
 * - /website test - Test website connection
 */

import { WebsiteIntegrationModule } from './module.js';

export default new WebsiteIntegrationModule();
export { WebsiteIntegrationModule };
export { WebsiteApiService } from './services/WebsiteApiService.js';
export { ActivityBatcher } from './services/ActivityBatcher.js';
export { LeaderboardSync } from './services/LeaderboardSync.js';
export { InteractionPoller } from './services/InteractionPoller.js';
export * from './types/website.types.js';
