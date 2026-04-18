import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
} from 'discord.js';
import type { SlashCommand } from '../../../types/command.types.js';
import type { MusicService } from '../services/MusicService.js';
import type { StreamingClient } from '../services/StreamingClient.js';
import type { PlaybackManager } from '../services/PlaybackManager.js';
import {
  createQueueEmbed,
  createPlaylistEmbed,
  createPlaylistListEmbed,
} from '../components/MusicPanel.js';
import { successEmbed, errorEmbed } from '../../../shared/utils/embed.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('MusicCommand');

let musicService: MusicService | null = null;
let streamingClient: StreamingClient | null = null;
let getPlaybackManager: ((guildId: string) => PlaybackManager | undefined) | null = null;

export function setMusicServices(
  service: MusicService,
  client: StreamingClient,
  getManager: (guildId: string) => PlaybackManager | undefined
): void {
  musicService = service;
  streamingClient = client;
  getPlaybackManager = getManager;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Music controls and playlist management')
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop playback, clear queue, and leave voice')
    )
    .addSubcommand((sub) =>
      sub.setName('skip').setDescription('Skip the current track')
    )
    .addSubcommand((sub) =>
      sub.setName('queue').setDescription('Show the current queue')
    )
    .addSubcommandGroup((group) =>
      group
        .setName('playlist')
        .setDescription('Playlist management')
        .addSubcommand((sub) =>
          sub
            .setName('create')
            .setDescription('Create a new playlist')
            .addStringOption((opt) =>
              opt.setName('name').setDescription('Playlist name').setRequired(true).setMaxLength(100)
            )
            .addBooleanOption((opt) =>
              opt.setName('public').setDescription('Make playlist public (default: true)').setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('delete')
            .setDescription('Delete a playlist you created')
            .addStringOption((opt) =>
              opt.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('add')
            .setDescription('Add a track to a playlist')
            .addStringOption((opt) =>
              opt.setName('playlist').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
            )
            .addStringOption((opt) =>
              opt.setName('query').setDescription('Song name or artist to search').setRequired(true)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('remove')
            .setDescription('Remove a track from a playlist by position')
            .addStringOption((opt) =>
              opt.setName('playlist').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
            )
            .addIntegerOption((opt) =>
              opt.setName('position').setDescription('Track position to remove').setRequired(true).setMinValue(1)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('list')
            .setDescription('List playlists')
            .addUserOption((opt) =>
              opt.setName('user').setDescription('View another user\'s public playlists').setRequired(false)
            )
        )
        .addSubcommand((sub) =>
          sub
            .setName('view')
            .setDescription('View tracks in a playlist')
            .addStringOption((opt) =>
              opt.setName('name').setDescription('Playlist name').setRequired(true).setAutocomplete(true)
            )
        )
    ) as unknown as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!musicService || !streamingClient || !getPlaybackManager) {
      await interaction.reply({ embeds: [errorEmbed('Service Unavailable', 'Music service is not available.')], ephemeral: true });
      return;
    }

    if (!interaction.guildId) {
      await interaction.reply({ embeds: [errorEmbed('Error', 'This command can only be used in a server.')], ephemeral: true });
      return;
    }

    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    if (subcommandGroup === 'playlist') {
      switch (subcommand) {
        case 'create':
          await handlePlaylistCreate(interaction);
          break;
        case 'delete':
          await handlePlaylistDelete(interaction);
          break;
        case 'add':
          await handlePlaylistAdd(interaction);
          break;
        case 'remove':
          await handlePlaylistRemove(interaction);
          break;
        case 'list':
          await handlePlaylistList(interaction);
          break;
        case 'view':
          await handlePlaylistView(interaction);
          break;
      }
      return;
    }

    switch (subcommand) {
      case 'stop':
        await handleStop(interaction);
        break;
      case 'skip':
        await handleSkip(interaction);
        break;
      case 'queue':
        await handleQueue(interaction);
        break;
    }
  },

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (!musicService || !interaction.guildId) {
      await interaction.respond([]);
      return;
    }

    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'name' && focused.name !== 'playlist') {
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

// ==================== Playback Control Handlers ====================

async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  const manager = getPlaybackManager!(interaction.guildId!);
  if (!manager || !manager.isConnected()) {
    await interaction.reply({ embeds: [errorEmbed('Not Playing', 'Nothing is currently playing.')], ephemeral: true });
    return;
  }

  manager.stop();
  await interaction.reply({ embeds: [successEmbed('Stopped', 'Playback stopped and queue cleared.')] });
}

async function handleSkip(interaction: ChatInputCommandInteraction): Promise<void> {
  const manager = getPlaybackManager!(interaction.guildId!);
  if (!manager || !manager.getCurrentEntry()) {
    await interaction.reply({ embeds: [errorEmbed('Not Playing', 'Nothing is currently playing.')], ephemeral: true });
    return;
  }

  const current = manager.getCurrentEntry()!;
  manager.skip();
  await interaction.reply({
    embeds: [successEmbed('Skipped', `Skipped **${current.track.title}** by ${current.track.artist}`)],
  });
}

async function handleQueue(interaction: ChatInputCommandInteraction): Promise<void> {
  const manager = getPlaybackManager!(interaction.guildId!);
  const currentEntry = manager?.getCurrentEntry() ?? null;
  const queue = manager?.getQueue() ?? [];

  await interaction.reply({
    embeds: [createQueueEmbed(currentEntry, queue)],
    ephemeral: true,
  });
}

// ==================== Playlist Handlers ====================

async function handlePlaylistCreate(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true).trim();
  const isPublic = interaction.options.getBoolean('public') ?? true;

  // Check if playlist already exists
  const existing = await musicService!.getPlaylistByName(interaction.user.id, interaction.guildId!, name);
  if (existing) {
    await interaction.reply({
      embeds: [errorEmbed('Already Exists', `You already have a playlist named **${name}**.`)],
      ephemeral: true,
    });
    return;
  }

  await musicService!.createPlaylist(interaction.user.id, interaction.guildId!, name, isPublic);
  await interaction.reply({
    embeds: [successEmbed('Playlist Created', `Created ${isPublic ? 'public' : 'private'} playlist **${name}**.`)],
  });
}

async function handlePlaylistDelete(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true).trim();

  const playlist = await musicService!.getPlaylistByName(interaction.user.id, interaction.guildId!, name);
  if (!playlist) {
    await interaction.reply({
      embeds: [errorEmbed('Not Found', `You don't have a playlist named **${name}**.`)],
      ephemeral: true,
    });
    return;
  }

  await musicService!.deletePlaylist(playlist.id, interaction.user.id);
  await interaction.reply({
    embeds: [successEmbed('Playlist Deleted', `Deleted playlist **${name}**.`)],
  });
}

async function handlePlaylistAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const playlistName = interaction.options.getString('playlist', true).trim();
  const query = interaction.options.getString('query', true);

  if (!streamingClient!.isConfigured()) {
    await interaction.reply({ embeds: [errorEmbed('Not Configured', 'Music streaming is not configured.')], ephemeral: true });
    return;
  }

  const playlist = await musicService!.getPlaylistByName(interaction.user.id, interaction.guildId!, playlistName);
  if (!playlist) {
    await interaction.reply({
      embeds: [errorEmbed('Not Found', `You don't have a playlist named **${playlistName}**.`)],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const results = await streamingClient!.search(query, 1);
    if (results.tracks.length === 0) {
      await interaction.editReply({ embeds: [errorEmbed('No Results', `No tracks found for: **${query}**`)] });
      return;
    }

    const streamTrack = results.tracks[0]!;
    const track = await musicService!.getOrCreateTrack(streamTrack);

    const added = await musicService!.addTrackToPlaylist(playlist.id, track.id);
    if (!added) {
      await interaction.editReply({
        embeds: [errorEmbed('Cannot Add', 'Track is already in the playlist or playlist is full.')],
      });
      return;
    }

    await interaction.editReply({
      embeds: [successEmbed('Track Added', `Added **${track.title}** by ${track.artist} to **${playlistName}**.`)],
    });
  } catch (error) {
    logger.error('Playlist add error:', error);
    await interaction.editReply({
      embeds: [errorEmbed('Error', 'Failed to search for tracks.')],
    });
  }
}

async function handlePlaylistRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const playlistName = interaction.options.getString('playlist', true).trim();
  const position = interaction.options.getInteger('position', true);

  const playlist = await musicService!.getPlaylistByName(interaction.user.id, interaction.guildId!, playlistName);
  if (!playlist) {
    await interaction.reply({
      embeds: [errorEmbed('Not Found', `You don't have a playlist named **${playlistName}**.`)],
      ephemeral: true,
    });
    return;
  }

  const removed = await musicService!.removeTrackFromPlaylist(playlist.id, position);
  if (!removed) {
    await interaction.reply({
      embeds: [errorEmbed('Invalid Position', `No track at position **${position}** in **${playlistName}**.`)],
      ephemeral: true,
    });
    return;
  }

  await interaction.reply({
    embeds: [successEmbed('Track Removed', `Removed track at position **${position}** from **${playlistName}**.`)],
  });
}

async function handlePlaylistList(interaction: ChatInputCommandInteraction): Promise<void> {
  const targetUser = interaction.options.getUser('user') ?? interaction.user;
  const isOwnPlaylists = targetUser.id === interaction.user.id;

  const playlists = isOwnPlaylists
    ? await musicService!.listPlaylists(targetUser.id, interaction.guildId!)
    : await musicService!.listPublicPlaylists(targetUser.id, interaction.guildId!);

  await interaction.reply({
    embeds: [createPlaylistListEmbed(targetUser.id, playlists)],
    ephemeral: true,
  });
}

async function handlePlaylistView(interaction: ChatInputCommandInteraction): Promise<void> {
  const name = interaction.options.getString('name', true).trim();

  const playlist = await musicService!.findPlaylist(interaction.guildId!, name, interaction.user.id);
  if (!playlist) {
    await interaction.reply({
      embeds: [errorEmbed('Not Found', `Playlist **${name}** not found.`)],
      ephemeral: true,
    });
    return;
  }

  // Check access: private playlists only visible to owner
  if (!playlist.is_public && playlist.user_id !== interaction.user.id) {
    await interaction.reply({
      embeds: [errorEmbed('Private', 'This playlist is private.')],
      ephemeral: true,
    });
    return;
  }

  const tracks = await musicService!.getPlaylistTracks(playlist.id);

  await interaction.reply({
    embeds: [
      createPlaylistEmbed(
        playlist.name,
        playlist.user_id,
        Boolean(playlist.is_public),
        tracks
      ),
    ],
    ephemeral: true,
  });
}
