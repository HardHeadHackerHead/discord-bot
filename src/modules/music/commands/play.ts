import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  GuildMember,
} from 'discord.js';
import type { SlashCommand } from '../../../types/command.types.js';
import type { MusicService } from '../services/MusicService.js';
import type { StreamingClient } from '../services/StreamingClient.js';
import type { PlaybackManager, QueueEntry } from '../services/PlaybackManager.js';
import { createNowPlayingEmbed } from '../components/MusicPanel.js';
import { errorEmbed } from '../../../shared/utils/embed.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('PlayCommand');

let musicService: MusicService | null = null;
let streamingClient: StreamingClient | null = null;
let getPlaybackManager: ((guildId: string) => PlaybackManager | undefined) | null = null;
let createPlaybackManager: ((guildId: string) => PlaybackManager) | null = null;

export function setPlayServices(
  service: MusicService,
  client: StreamingClient,
  getManager: (guildId: string) => PlaybackManager | undefined,
  createManager: (guildId: string) => PlaybackManager
): void {
  musicService = service;
  streamingClient = client;
  getPlaybackManager = getManager;
  createPlaybackManager = createManager;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Play music in your voice channel')
    .addStringOption((opt) =>
      opt
        .setName('query')
        .setDescription('Song name or artist to search for')
        .setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('playlist')
        .setDescription('Play a saved playlist instead')
        .setRequired(false)
        .setAutocomplete(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!musicService || !streamingClient || !getPlaybackManager || !createPlaybackManager) {
      await interaction.reply({ embeds: [errorEmbed('Service Unavailable', 'Music service is not available.')], ephemeral: true });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed('Error', 'This command can only be used in a server.')], ephemeral: true });
      return;
    }

    if (!streamingClient.isConfigured()) {
      await interaction.reply({ embeds: [errorEmbed('Not Configured', 'Music streaming is not configured. Contact a server administrator.')], ephemeral: true });
      return;
    }

    const member = interaction.member as GuildMember;
    const voiceChannel = member.voice.channel;

    if (!voiceChannel) {
      await interaction.reply({ embeds: [errorEmbed('Not in Voice', 'You must be in a voice channel to play music.')], ephemeral: true });
      return;
    }

    await interaction.deferReply();

    const playlistName = interaction.options.getString('playlist');
    const query = interaction.options.getString('query', true);

    try {
      let manager = getPlaybackManager(interaction.guildId);
      if (!manager) {
        manager = createPlaybackManager(interaction.guildId);
      }

      // Join voice channel
      await manager.join(voiceChannel);

      if (playlistName) {
        // Play a playlist
        await handlePlayPlaylist(interaction, manager, playlistName);
      } else {
        // Search and play a single track
        await handlePlaySearch(interaction, manager, query);
      }
    } catch (error) {
      logger.error('Play command error:', error);
      await interaction.editReply({
        embeds: [errorEmbed('Playback Error', `Failed to start playback: ${error instanceof Error ? error.message : 'Unknown error'}`)],
      });
    }
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (!musicService || !interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'playlist') {
      await interaction.respond([]);
      return;
    }

    const names = await musicService.getPlaylistNames(interaction.guildId, interaction.user.id);
    const filtered = names
      .filter((n) => n.toLowerCase().includes(focused.value.toLowerCase()))
      .slice(0, 25)
      .map((n) => ({ name: n, value: n }));

    await interaction.respond(filtered);
  },
};

async function handlePlaySearch(
  interaction: ChatInputCommandInteraction,
  manager: PlaybackManager,
  query: string
): Promise<void> {
  const results = await streamingClient!.search(query, 1);

  if (results.tracks.length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed('No Results', `No tracks found for: **${query}**`)],
    });
    return;
  }

  const streamTrack = results.tracks[0]!;
  const track = await musicService!.getOrCreateTrack(streamTrack);

  const entry: QueueEntry = {
    track,
    requestedBy: interaction.user.id,
    textChannelId: interaction.channelId,
  };

  manager.enqueue([entry]);

  // Record play event
  await musicService!.recordPlay(track.id, interaction.guildId!, interaction.user.id, interaction.channelId);

  const playCount = await musicService!.getPlayCount(track.id, interaction.guildId!);
  const likeCount = await musicService!.getLikeCount(track.id, interaction.guildId!);
  const hasLiked = await musicService!.hasLiked(interaction.user.id, interaction.guildId!, track.id);

  const { embed, row } = createNowPlayingEmbed(
    track,
    interaction.user.id,
    manager.getTotalSize(),
    manager.getTotalSize(),
    playCount,
    likeCount,
    hasLiked
  );

  if (manager.getQueueLength() > 0) {
    // Track was queued, not immediately playing
    embed.setTitle('Added to Queue');
    embed.setFooter({ text: `Position ${manager.getTotalSize()} in queue` });
  }

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handlePlayPlaylist(
  interaction: ChatInputCommandInteraction,
  manager: PlaybackManager,
  playlistName: string
): Promise<void> {
  const playlist = await musicService!.findPlaylist(interaction.guildId!, playlistName, interaction.user.id);

  if (!playlist) {
    await interaction.editReply({
      embeds: [errorEmbed('Not Found', `Playlist **${playlistName}** not found.`)],
    });
    return;
  }

  const tracks = await musicService!.getPlaylistTracks(playlist.id);

  if (tracks.length === 0) {
    await interaction.editReply({
      embeds: [errorEmbed('Empty Playlist', `Playlist **${playlistName}** has no tracks.`)],
    });
    return;
  }

  const entries: QueueEntry[] = tracks.map((t) => ({
    track: {
      id: t.track_id,
      external_id: t.external_id,
      provider: t.provider,
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration,
      artwork_url: t.artwork_url,
      created_at: t.added_at,
      updated_at: t.added_at,
    },
    requestedBy: interaction.user.id,
    textChannelId: interaction.channelId,
  }));

  manager.enqueue(entries);

  const firstEntry = entries[0]!;

  const embed = createNowPlayingEmbed(
    firstEntry.track,
    interaction.user.id,
    1,
    entries.length,
    0,
    0,
    false
  ).embed;

  embed.setTitle(`Playing Playlist: ${playlistName}`);
  embed.setFooter({ text: `${entries.length} tracks added to queue` });

  const row = createNowPlayingEmbed(firstEntry.track, interaction.user.id, 1, entries.length, 0, 0, false).row;

  await interaction.editReply({ embeds: [embed], components: [row] });
}
