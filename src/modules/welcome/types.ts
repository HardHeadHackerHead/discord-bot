/**
 * Welcome Module Type Definitions
 */

/**
 * Guild welcome settings stored in database
 */
export interface WelcomeSettings {
  id: string;
  guild_id: string;
  enabled: boolean;
  welcome_channel_id: string | null;
  send_dm: boolean;
  message_template: string | null;
  embed_title: string | null;
  embed_description: string | null;
  embed_color: string;
  include_image: boolean;
  mention_user: boolean;
  use_ai_message: boolean;
  ai_prompt_template: string | null;
  use_ai_image: boolean;
  ai_image_prompt: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Welcome image stored in database
 */
export interface WelcomeImage {
  id: string;
  guild_id: string;
  user_id: string;
  image_path: string;
  prompt_index: number | null;
  prompt_text: string | null;
  model: string;
  cost: number;
  created_at: Date;
}

/**
 * Welcome history entry for tracking sent welcomes
 */
export interface WelcomeHistoryEntry {
  id: string;
  guild_id: string;
  user_id: string;
  channel_id: string | null;
  message_id: string | null;
  sent_dm: boolean;
  image_generated: boolean;
  image_id: string | null;
  // Legacy fields (kept for backward compatibility)
  image_path: string | null;
  image_prompt_index: number | null;
  image_prompt_text: string | null;
  image_model: string | null;
  image_cost: number | null;
  ai_message_generated: boolean;
  ai_tokens_used: number;
  error_message: string | null;
  created_at: Date;
}

/**
 * Options for generating welcome images
 */
export interface ImageGenerationOptions {
  avatarUrl: string;
  username: string;
  glowColor?: string;
}

/**
 * Default values for welcome settings
 */
export const DEFAULT_MESSAGE_TEMPLATE = 'Welcome to **{server}**, {user}! You are member #{memberCount}!';
export const DEFAULT_EMBED_TITLE = 'Welcome to the Lab!';
export const DEFAULT_EMBED_DESCRIPTION = 'We are glad to have you here. Check out our channels and enjoy your stay!';
export const DEFAULT_EMBED_COLOR = '#00D4FF';
export const DEFAULT_AI_PROMPT = `You are Nimrod, the friendly lab assistant bot for QuadsLab Discord server. Generate a brief, warm, and unique welcome message for a new member. Keep it under 2 sentences. Be creative but professional. The member's name is {username} and they just joined {server}.`;
