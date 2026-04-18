/**
 * Social Feeds Module - Social media notification system
 *
 * Features:
 * - YouTube channel RSS monitoring
 * - Automatic posting of new videos
 * - Configurable notification channels and messages
 * - Duplicate prevention
 *
 * Commands:
 * - /social youtube <channel> <post_channel> - Add a YouTube feed
 * - /social list - List all configured feeds
 * - /social remove <feed> - Remove a feed
 * - /social toggle <feed> - Enable/disable a feed
 * - /social channel <feed> <channel> - Change post channel
 * - /social test <feed> - Preview latest item
 *
 * Extensibility:
 * - Designed to support additional platforms in the future
 * - Platform-agnostic service layer
 * - Modular fetcher architecture
 */

import { SocialFeedsModule } from './module.js';

export default new SocialFeedsModule();
export { SocialFeedsModule };
export { SocialFeedsService } from './services/SocialFeedsService.js';
export { FeedChecker } from './services/FeedChecker.js';
export { YouTubeFetcher, youtubeFetcher } from './services/YouTubeFetcher.js';
