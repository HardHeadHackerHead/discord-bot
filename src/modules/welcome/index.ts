/**
 * Welcome Module - Branded welcome messages for new members
 *
 * This module welcomes new members with custom lab-themed images
 * featuring neon glow effects, and optionally AI-generated personalized
 * welcome messages.
 *
 * Features:
 * - Custom welcome images with circular avatar and neon glow frame
 * - AI-generated personalized welcome messages (Claude/OpenAI)
 * - Configurable welcome channel and DM options
 * - Template-based messages with placeholders
 * - Welcome history tracking
 *
 * Commands:
 * - /welcome setup <channel> - Quick setup (sets channel and enables)
 * - /welcome toggle - Enable/disable welcome messages
 * - /welcome channel <channel> - Set welcome channel
 * - /welcome color <hex> - Set glow color (default: #00D4FF)
 * - /welcome dm - Toggle DM to new members
 * - /welcome image - Toggle image generation
 * - /welcome ai - Toggle AI-generated messages
 * - /welcome prompt <text> - Set custom AI prompt template
 * - /welcome test - Preview welcome on yourself
 * - /welcome settings - View current configuration
 *
 * Events:
 * - guildMemberAdd - Triggers welcome message when new member joins
 *
 * Database Tables:
 * - welcome_guild_settings - Guild-specific welcome configuration
 * - welcome_history - History of sent welcome messages
 */

import { WelcomeModule } from './module.js';

// Export default module instance (required by module loader)
export default new WelcomeModule();

// Export module class for type usage
export { WelcomeModule };

// Export services for potential external use
export { WelcomeService } from './services/WelcomeService.js';
export { WelcomeImageService } from './services/ImageService.js';

// Export types
export type { WelcomeSettings, WelcomeHistoryEntry, ImageGenerationOptions } from './types.js';
