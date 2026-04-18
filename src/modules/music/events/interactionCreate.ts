import { Interaction, ButtonInteraction } from 'discord.js';
import type { AnyModuleEvent } from '../../../types/event.types.js';
import type { MusicService } from '../services/MusicService.js';
import type { PlaybackManager } from '../services/PlaybackManager.js';
import { createNowPlayingEmbed, createQueueEmbed, createNowPlayingButtons } from '../components/MusicPanel.js';
import { errorEmbed, successEmbed } from '../../../shared/utils/embed.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('MusicInteraction');

let musicService: MusicService | null = null;
let getPlaybackManager: ((guildId: string) => PlaybackManager | undefined) | null = null;

export function setInteractionServices(
  service: MusicService,
  getManager: (guildId: string) => PlaybackManager | undefined
): void {
  musicService = service;
  getPlaybackManager = getManager;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;

    if (!musicService || !getPlaybackManager) return;
    if (!interaction.guildId) return;

    if (interaction.isButton()) {
      const customId = interaction.customId;

      if (customId.startsWith('music:like:')) {
        await handleLikeButton(interaction);
      } else if (customId === 'music:skip') {
        await handleSkipButton(interaction);
      } else if (customId === 'music:stop') {
        await handleStopButton(interaction);
      } else if (customId === 'music:queue') {
        await handleQueueButton(interaction);
      }
    }
  },
};

async function handleLikeButton(interaction: ButtonInteraction): Promise<void> {
  const trackId = interaction.customId.split(':')[2];
  if (!trackId) return;

  try {
    const liked = await musicService!.toggleLike(
      interaction.user.id,
      interaction.guildId!,
      trackId
    );

    const likeCount = await musicService!.getLikeCount(trackId, interaction.guildId!);

    // Update the button to reflect new state
    const row = createNowPlayingButtons(trackId, liked);

    // Update the embed's like count
    const message = interaction.message;
    const existingEmbed = message.embeds[0];
    if (existingEmbed) {
      const fields = existingEmbed.fields.map((f) => {
        if (f.name === 'Likes') {
          return { ...f, value: String(likeCount) };
        }
        return f;
      });

      const updatedEmbed = { ...existingEmbed.data, fields };
      await interaction.update({ embeds: [updatedEmbed], components: [row] });
    } else {
      await interaction.reply({
        content: liked ? 'Liked!' : 'Unliked!',
        ephemeral: true,
      });
    }
  } catch (error) {
    logger.error('Like button error:', error);
    await interaction.reply({ content: 'Failed to toggle like.', ephemeral: true });
  }
}

async function handleSkipButton(interaction: ButtonInteraction): Promise<void> {
  const manager = getPlaybackManager!(interaction.guildId!);
  if (!manager || !manager.getCurrentEntry()) {
    await interaction.reply({
      embeds: [errorEmbed('Not Playing', 'Nothing is currently playing.')],
      ephemeral: true,
    });
    return;
  }

  const current = manager.getCurrentEntry()!;
  manager.skip();

  await interaction.reply({
    embeds: [successEmbed('Skipped', `**${current.track.title}** was skipped by <@${interaction.user.id}>`)],
  });
}

async function handleStopButton(interaction: ButtonInteraction): Promise<void> {
  const manager = getPlaybackManager!(interaction.guildId!);
  if (!manager || !manager.isConnected()) {
    await interaction.reply({
      embeds: [errorEmbed('Not Playing', 'Nothing is currently playing.')],
      ephemeral: true,
    });
    return;
  }

  manager.stop();

  await interaction.reply({
    embeds: [successEmbed('Stopped', `Playback stopped by <@${interaction.user.id}>`)],
  });
}

async function handleQueueButton(interaction: ButtonInteraction): Promise<void> {
  const manager = getPlaybackManager!(interaction.guildId!);
  const currentEntry = manager?.getCurrentEntry() ?? null;
  const queue = manager?.getQueue() ?? [];

  await interaction.reply({
    embeds: [createQueueEmbed(currentEntry, queue)],
    ephemeral: true,
  });
}
