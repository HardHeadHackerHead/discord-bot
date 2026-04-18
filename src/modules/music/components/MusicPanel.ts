import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { COLORS, createEmbed, progressBar } from '../../../shared/utils/embed.js';
import type { MusicTrackRow } from '../services/MusicService.js';
import type { QueueEntry } from '../services/PlaybackManager.js';

/**
 * Format a duration in seconds to MM:SS or HH:MM:SS
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Build the "Now Playing" embed with action buttons
 */
export function createNowPlayingEmbed(
  track: MusicTrackRow,
  requestedBy: string,
  queuePosition: number,
  queueTotal: number,
  playCount: number,
  likeCount: number,
  userHasLiked: boolean
): { embed: EmbedBuilder; row: ActionRowBuilder<ButtonBuilder> } {
  const embed = createEmbed(COLORS.primary)
    .setTitle('Now Playing')
    .setDescription(`**${track.title}** by ${track.artist}`);

  if (track.album) {
    embed.addFields({ name: 'Album', value: track.album, inline: true });
  }

  embed.addFields(
    { name: 'Duration', value: formatDuration(track.duration), inline: true },
    { name: 'Requested by', value: `<@${requestedBy}>`, inline: true },
    { name: 'Play Count', value: String(playCount), inline: true },
    { name: 'Likes', value: String(likeCount), inline: true }
  );

  if (track.artwork_url) {
    embed.setThumbnail(track.artwork_url);
  }

  embed.setFooter({ text: `Track ${queuePosition} of ${queueTotal} in queue` });

  const row = createNowPlayingButtons(track.id, userHasLiked);

  return { embed, row };
}

/**
 * Build the button row for the Now Playing embed
 */
export function createNowPlayingButtons(
  trackId: string,
  userHasLiked: boolean
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`music:like:${trackId}`)
      .setEmoji(userHasLiked ? '❤️' : '🤍')
      .setStyle(userHasLiked ? ButtonStyle.Danger : ButtonStyle.Secondary)
      .setLabel('Like'),
    new ButtonBuilder()
      .setCustomId('music:skip')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Skip'),
    new ButtonBuilder()
      .setCustomId('music:stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger)
      .setLabel('Stop'),
    new ButtonBuilder()
      .setCustomId('music:queue')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary)
      .setLabel('Queue')
  );
}

/**
 * Build the queue embed
 */
export function createQueueEmbed(
  currentEntry: QueueEntry | null,
  queue: QueueEntry[]
): EmbedBuilder {
  const embed = createEmbed(COLORS.info).setTitle('Music Queue');

  if (!currentEntry && queue.length === 0) {
    embed.setDescription('The queue is empty.');
    return embed;
  }

  const lines: string[] = [];

  if (currentEntry) {
    lines.push(
      `**Now Playing:** ${currentEntry.track.title} by ${currentEntry.track.artist} [${formatDuration(currentEntry.track.duration)}]`
    );
    lines.push('');
  }

  if (queue.length > 0) {
    lines.push('**Up Next:**');
    const displayed = queue.slice(0, 15);
    displayed.forEach((entry, i) => {
      lines.push(
        `\`${i + 1}.\` **${entry.track.title}** by ${entry.track.artist} [${formatDuration(entry.track.duration)}] — <@${entry.requestedBy}>`
      );
    });

    if (queue.length > 15) {
      lines.push(`\n*...and ${queue.length - 15} more tracks*`);
    }
  }

  const totalDuration = queue.reduce((sum, e) => sum + e.track.duration, 0) +
    (currentEntry?.track.duration ?? 0);
  lines.push(`\n**Total:** ${queue.length + (currentEntry ? 1 : 0)} tracks — ${formatDuration(totalDuration)}`);

  embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * Build a playlist view embed
 */
export function createPlaylistEmbed(
  playlistName: string,
  ownerUserId: string,
  isPublic: boolean,
  tracks: { title: string; artist: string; duration: number }[]
): EmbedBuilder {
  const embed = createEmbed(COLORS.info)
    .setTitle(`Playlist: ${playlistName}`)
    .setDescription(
      `Created by <@${ownerUserId}> — ${isPublic ? 'Public' : 'Private'}\n` +
      `**${tracks.length}** track${tracks.length === 1 ? '' : 's'}`
    );

  if (tracks.length > 0) {
    const lines = tracks.slice(0, 20).map(
      (t, i) => `\`${i + 1}.\` **${t.title}** by ${t.artist} [${formatDuration(t.duration)}]`
    );

    if (tracks.length > 20) {
      lines.push(`\n*...and ${tracks.length - 20} more tracks*`);
    }

    embed.addFields({ name: 'Tracks', value: lines.join('\n') });
  }

  const totalDuration = tracks.reduce((sum, t) => sum + t.duration, 0);
  embed.setFooter({ text: `Total duration: ${formatDuration(totalDuration)}` });

  return embed;
}

/**
 * Build a playlist list embed
 */
export function createPlaylistListEmbed(
  targetUserId: string,
  playlists: { name: string; track_count: number; is_public: boolean }[]
): EmbedBuilder {
  const embed = createEmbed(COLORS.info)
    .setTitle(`Playlists`)
    .setDescription(`Playlists for <@${targetUserId}>`);

  if (playlists.length === 0) {
    embed.addFields({ name: '\u200b', value: 'No playlists found.' });
    return embed;
  }

  const lines = playlists.map(
    (p) => `• **${p.name}** — ${p.track_count} track${p.track_count === 1 ? '' : 's'} ${p.is_public ? '' : '(Private)'}`
  );

  embed.addFields({ name: `${playlists.length} playlist${playlists.length === 1 ? '' : 's'}`, value: lines.join('\n') });

  return embed;
}

/**
 * Build a search results embed for track selection
 */
export function createSearchResultsEmbed(
  query: string,
  tracks: { id: string; title: string; artist: string; duration: number }[]
): EmbedBuilder {
  const embed = createEmbed(COLORS.info)
    .setTitle('Search Results')
    .setDescription(`Results for: **${query}**`);

  if (tracks.length === 0) {
    embed.addFields({ name: '\u200b', value: 'No tracks found.' });
    return embed;
  }

  const lines = tracks.slice(0, 10).map(
    (t, i) => `\`${i + 1}.\` **${t.title}** by ${t.artist} [${formatDuration(t.duration)}]`
  );

  embed.addFields({ name: 'Tracks', value: lines.join('\n') });
  return embed;
}
