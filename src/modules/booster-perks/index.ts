/**
 * Booster Perks Module - Exclusive features for server boosters
 *
 * Features:
 * - Custom soundboard sounds from URLs (.mp3, .wav, .ogg)
 * - Custom emojis from URLs (.png, .jpg, .gif, .webp)
 * - Configurable per-user limits for each perk type
 * - Interactive panel-driven management (no subcommands needed)
 *
 * Commands:
 * - /booster - Opens the booster perks panel (or promo for non-boosters)
 *
 * Settings:
 * - max_sounds_per_user: Max sounds per booster (1-25, default: 5)
 * - max_emojis_per_user: Max emojis per booster (1-15, default: 3)
 */

import { BoosterPerksModule } from './module.js';

export default new BoosterPerksModule();
export { BoosterPerksModule };
export { BoosterPerksService } from './services/BoosterPerksService.js';
