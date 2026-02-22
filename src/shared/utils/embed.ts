import { EmbedBuilder, ColorResolvable, User, Guild } from 'discord.js';

/**
 * Standard embed colors used throughout the bot
 */
export const COLORS = {
  primary: 0x5865F2,    // Discord Blurple
  success: 0x57F287,    // Green
  warning: 0xFEE75C,    // Yellow
  error: 0xED4245,      // Red
  info: 0x5865F2,       // Blurple
  neutral: 0x99AAB5,    // Grey
} as const;

/**
 * Create a base embed with consistent styling
 */
export function createEmbed(color: ColorResolvable = COLORS.primary): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(color)
    .setTimestamp();
}

/**
 * Create a success embed
 */
export function successEmbed(
  title: string,
  description?: string
): EmbedBuilder {
  const embed = createEmbed(COLORS.success).setTitle(`✅ ${title}`);
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}

/**
 * Create an error embed
 */
export function errorEmbed(
  title: string,
  description?: string
): EmbedBuilder {
  const embed = createEmbed(COLORS.error).setTitle(`❌ ${title}`);
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}

/**
 * Create a warning embed
 */
export function warningEmbed(
  title: string,
  description?: string
): EmbedBuilder {
  const embed = createEmbed(COLORS.warning).setTitle(`⚠️ ${title}`);
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}

/**
 * Create an info embed
 */
export function infoEmbed(
  title: string,
  description?: string
): EmbedBuilder {
  const embed = createEmbed(COLORS.info).setTitle(`ℹ️ ${title}`);
  if (description) {
    embed.setDescription(description);
  }
  return embed;
}

/**
 * Create a loading embed
 */
export function loadingEmbed(message: string = 'Loading...'): EmbedBuilder {
  return createEmbed(COLORS.neutral)
    .setDescription(`⏳ ${message}`);
}

/**
 * Add user footer to embed
 */
export function withUserFooter(
  embed: EmbedBuilder,
  user: User
): EmbedBuilder {
  return embed.setFooter({
    text: `Requested by ${user.username}`,
    iconURL: user.displayAvatarURL(),
  });
}

/**
 * Add guild branding to embed
 */
export function withGuildBranding(
  embed: EmbedBuilder,
  guild: Guild
): EmbedBuilder {
  const iconURL = guild.iconURL();
  if (iconURL) {
    embed.setThumbnail(iconURL);
  }
  return embed;
}

/**
 * Format a field value for embed display
 * Truncates if too long and adds ellipsis
 */
export function truncateField(value: string, maxLength: number = 1024): string {
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(0, maxLength - 3) + '...';
}

/**
 * Format a list of items as a numbered list
 */
export function numberedList(items: string[], startIndex: number = 1): string {
  return items
    .map((item, index) => `${startIndex + index}. ${item}`)
    .join('\n');
}

/**
 * Format a list of items as bullet points
 */
export function bulletList(items: string[]): string {
  return items.map(item => `• ${item}`).join('\n');
}

/**
 * Create a progress bar string
 */
export function progressBar(
  current: number,
  total: number,
  length: number = 10,
  filledChar: string = '█',
  emptyChar: string = '░'
): string {
  const percentage = Math.min(current / total, 1);
  const filled = Math.round(percentage * length);
  const empty = length - filled;

  return filledChar.repeat(filled) + emptyChar.repeat(empty);
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
