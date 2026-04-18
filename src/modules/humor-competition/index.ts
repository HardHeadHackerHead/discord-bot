/**
 * Humor Competition Module - Daily AI Picture Humor Competition
 *
 * Zero-config, channel-name-driven:
 * - Auto-creates "daily-humor" forum, "Humor Manager" role, "King of Humor" role
 * - Daily at 3 AM ET: ends yesterday's competition, picks winner (or tie-breaker dropdown),
 *   cleans up unused threads, checks role expiry, then creates today's post
 * - On startup: catches up — ensures today's post exists
 * - Trusted role members post the source image, users post AI images
 * - Bot auto-reacts 👍 👎, tallies votes at end
 * - Non-image messages deleted with temporary warning
 * - Winner keeps King of Humor role for 7 days (rolling)
 * - Ties: manager picks winner via dropdown
 *
 * No slash commands — fully automatic.
 */

import { HumorCompetitionModule, getHumorCompetitionService } from './module.js';

export default new HumorCompetitionModule();
export { HumorCompetitionModule, getHumorCompetitionService };
