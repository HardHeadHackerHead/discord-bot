import { SlashCommandBuilder, ChatInputCommandInteraction, GuildMember, PermissionFlagsBits } from 'discord.js';
import { joinVoiceChannel, getVoiceConnection, VoiceConnectionStatus, entersState } from '@discordjs/voice';
import { SlashCommand } from '../../../types/command.types.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('VoiceJoin:Command');

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Voice channel commands for testing')
    .addSubcommand(sub =>
      sub
        .setName('join')
        .setDescription('Make the bot join your voice channel')
    )
    .addSubcommand(sub =>
      sub
        .setName('leave')
        .setDescription('Make the bot leave the voice channel')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'join') {
      await handleJoin(interaction);
    } else if (subcommand === 'leave') {
      await handleLeave(interaction);
    }
  },
};

async function handleJoin(interaction: ChatInputCommandInteraction): Promise<void> {
  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({
      content: 'You need to be in a voice channel first!',
      ephemeral: true,
    });
    return;
  }

  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  // Defer the reply since joining may take time
  await interaction.deferReply({ ephemeral: true });

  try {
    // Check if already connected to a voice channel in this guild
    const existingConnection = getVoiceConnection(interaction.guild.id);
    if (existingConnection) {
      existingConnection.destroy();
    }

    // Join the voice channel
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guild.id,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    logger.debug(`Connection created, current state: ${connection.state.status}`);

    // If already ready, no need to wait
    if (connection.state.status === VoiceConnectionStatus.Ready) {
      await interaction.editReply({
        content: `Joined **${voiceChannel.name}**!`,
      });
      logger.info(`Joined voice channel ${voiceChannel.name} in ${interaction.guild.name}`);
      return;
    }

    // Wait a moment for the connection to establish
    await new Promise<void>((resolve) => {
      // If already ready, resolve immediately
      if (connection.state.status === VoiceConnectionStatus.Ready) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        // After timeout, resolve anyway - we'll check actual connection below
        resolve();
      }, 3_000);

      connection.once(VoiceConnectionStatus.Ready, () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    // Verify the bot is actually in the voice channel
    const botMember = interaction.guild.members.me;
    if (!botMember?.voice.channelId) {
      throw new Error('Bot did not join the voice channel');
    }

    await interaction.editReply({
      content: `Joined **${voiceChannel.name}**!`,
    });

    logger.info(`Joined voice channel ${voiceChannel.name} in ${interaction.guild.name}`);
  } catch (error) {
    logger.error('Failed to join voice channel:', error);

    // Check if we actually joined despite the error
    const currentConnection = getVoiceConnection(interaction.guild.id);
    if (currentConnection && currentConnection.state.status === VoiceConnectionStatus.Ready) {
      await interaction.editReply({
        content: `Joined **${voiceChannel.name}**!`,
      });
      logger.info(`Joined voice channel ${voiceChannel.name} (recovered from error)`);
    } else {
      await interaction.editReply({
        content: 'Failed to join voice channel. Make sure I have permission to connect.',
      });
    }
  }
}

async function handleLeave(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const connection = getVoiceConnection(interaction.guild.id);

  if (!connection) {
    await interaction.reply({
      content: 'I\'m not in a voice channel.',
      ephemeral: true,
    });
    return;
  }

  connection.destroy();

  await interaction.reply({
    content: 'Left the voice channel.',
    ephemeral: true,
  });

  logger.info(`Left voice channel in ${interaction.guild.name}`);
}
