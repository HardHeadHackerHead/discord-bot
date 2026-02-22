/**
 * Time formatting utilities
 */

/**
 * Format seconds into a human-readable duration string
 * @param seconds Total seconds
 * @returns Formatted string like "2h 30m 15s" or "3d 5h"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Format seconds into a more verbose duration string
 * @param seconds Total seconds
 * @returns Formatted string like "2 hours, 30 minutes, 15 seconds"
 */
export function formatDurationLong(seconds: number): string {
  if (seconds < 0) seconds = 0;

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];

  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);

  if (parts.length === 1) return parts[0]!;
  if (parts.length === 2) return parts.join(' and ');
  return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
}

/**
 * Format a date relative to now (e.g., "2 hours ago", "in 3 days")
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffSecs = Math.abs(Math.floor(diffMs / 1000));
  const isPast = diffMs < 0;

  const duration = formatDuration(diffSecs);
  return isPast ? `${duration} ago` : `in ${duration}`;
}

/**
 * Discord timestamp format types
 */
export type TimestampStyle = 't' | 'T' | 'd' | 'D' | 'f' | 'F' | 'R';

/**
 * Format a date as a Discord timestamp
 * @param date Date to format
 * @param style Timestamp style (default: 'f' for full date and time)
 *   - t: Short time (e.g., 9:41 PM)
 *   - T: Long time (e.g., 9:41:30 PM)
 *   - d: Short date (e.g., 01/20/2025)
 *   - D: Long date (e.g., January 20, 2025)
 *   - f: Full date and time (e.g., January 20, 2025 9:41 PM)
 *   - F: Full date and time with day (e.g., Monday, January 20, 2025 9:41 PM)
 *   - R: Relative (e.g., 2 hours ago)
 */
export function discordTimestamp(date: Date, style: TimestampStyle = 'f'): string {
  const timestamp = Math.floor(date.getTime() / 1000);
  return `<t:${timestamp}:${style}>`;
}

/**
 * Parse a duration string into seconds
 * Supports formats like "1h30m", "2d", "90m", "1h 30m"
 */
export function parseDuration(input: string): number | null {
  const pattern = /(\d+)\s*(d|h|m|s)/gi;
  let totalSeconds = 0;
  let match;
  let hasMatch = false;

  while ((match = pattern.exec(input)) !== null) {
    hasMatch = true;
    const value = parseInt(match[1]!, 10);
    const unit = match[2]!.toLowerCase();

    switch (unit) {
      case 'd':
        totalSeconds += value * 86400;
        break;
      case 'h':
        totalSeconds += value * 3600;
        break;
      case 'm':
        totalSeconds += value * 60;
        break;
      case 's':
        totalSeconds += value;
        break;
    }
  }

  return hasMatch ? totalSeconds : null;
}

/**
 * Get the start of the current day (midnight UTC)
 */
export function startOfDayUTC(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the start of the current week (Monday midnight UTC)
 */
export function startOfWeekUTC(date: Date = new Date()): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Get the start of the current month (1st midnight UTC)
 */
export function startOfMonthUTC(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}
