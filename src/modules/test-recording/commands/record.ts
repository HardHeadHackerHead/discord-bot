import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { Logger } from '../../../shared/utils/logger.js';
import {
  getVoiceRecorder,
  VoiceRecorder,
  destroyVoiceRecorder,
} from '../../../core/voice/VoiceRecorder.js';
import path from 'path';

const logger = new Logger('TestRecording:Command');

// Store active recording guilds
const activeRecordings = new Map<string, { startedAt: Date; outputDir: string }>();

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('record')
    .setDescription('EXPERIMENTAL: Test voice recording')
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('Start recording the voice channel')
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop recording and save files')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Check recording status')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'start':
        await handleStart(interaction);
        break;
      case 'stop':
        await handleStop(interaction);
        break;
      case 'status':
        await handleStatus(interaction);
        break;
    }
  },
};

async function handleStart(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel) {
    await interaction.reply({
      content: 'You need to be in a voice channel first!',
      ephemeral: true,
    });
    return;
  }

  // Check if prism-media with Opus support is available
  if (!VoiceRecorder.isAvailable()) {
    await interaction.reply({
      content:
        '**Voice recording is not available.**\n\n' +
        'Missing dependencies: `prism-media` + Opus library\n\n' +
        'To enable recording, run:\n```\nnpm install prism-media opusscript\n```',
      ephemeral: true,
    });
    return;
  }

  const recorder = getVoiceRecorder();

  // Check if already recording
  if (recorder.isRecording()) {
    await interaction.reply({
      content: 'Already recording! Use `/record stop` to stop first.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Join the voice channel
    const joined = await recorder.joinChannel(voiceChannel);
    if (!joined) {
      await interaction.editReply({
        content: 'Failed to join voice channel. Check bot permissions.',
      });
      return;
    }

    // Create output directory for this recording
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(
      process.cwd(),
      'recordings',
      interaction.guild.id,
      timestamp
    );

    // Check if FFmpeg is available for MP3 conversion
    const hasFfmpeg = await VoiceRecorder.checkFfmpeg();

    // Start recording (use MP3 format if FFmpeg is available)
    const started = recorder.startRecording({
      outputDir,
      separateUsers: true,
      format: hasFfmpeg ? 'mp3' : 'pcm',
      deleteOriginal: true, // Delete PCM files after converting to MP3
    });

    if (!started) {
      recorder.disconnect();
      await interaction.editReply({
        content: 'Failed to start recording. Check console for errors.',
      });
      return;
    }

    // Track this recording
    activeRecordings.set(interaction.guild.id, {
      startedAt: new Date(),
      outputDir,
    });

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('Recording Started')
      .setDescription(
        `Now recording in **${voiceChannel.name}**\n\n` +
          `Files will be saved to:\n\`${outputDir}\`\n\n` +
          `**Format:** ${hasFfmpeg ? 'MP3 (auto-converted)' : 'PCM (raw audio)'}\n\n` +
          '**Note:** Recording captures audio when users speak.\n' +
          'Use `/record stop` to stop recording.'
      )
      .setFooter({ text: 'EXPERIMENTAL FEATURE' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    logger.info(
      `Started recording in ${voiceChannel.name} (${interaction.guild.name})`
    );
  } catch (error) {
    logger.error('Failed to start recording:', error);
    await interaction.editReply({
      content: `Failed to start recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function handleStop(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const recorder = getVoiceRecorder();

  if (!recorder.isRecording()) {
    await interaction.reply({
      content: 'Not currently recording. Use `/record start` to begin.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Stop recording
    const session = await recorder.stopRecording();

    // Get recording info
    const recordingInfo = activeRecordings.get(interaction.guild.id);
    activeRecordings.delete(interaction.guild.id);

    // Disconnect from voice
    recorder.disconnect();

    if (!session) {
      await interaction.editReply({
        content: 'Recording stopped but no session data available.',
      });
      return;
    }

    const duration = recordingInfo
      ? Math.floor((Date.now() - recordingInfo.startedAt.getTime()) / 1000)
      : 0;

    // Build description based on format used
    let description = `Recording session ended.\n\n` +
      `**Duration:** ${formatDuration(duration)}\n` +
      `**Users recorded:** ${session.users.size}\n` +
      `**Output directory:**\n\`${session.outputDir}\`\n\n`;

    if (session.mp3Files && session.mp3Files.length > 0) {
      description += `**MP3 files created:** ${session.mp3Files.length}\n`;
      // List the files (just filenames, not full paths)
      const fileNames = session.mp3Files.map(f => path.basename(f));
      if (fileNames.length <= 5) {
        description += fileNames.map(f => `• \`${f}\``).join('\n');
      } else {
        description += fileNames.slice(0, 5).map(f => `• \`${f}\``).join('\n');
        description += `\n• _...and ${fileNames.length - 5} more_`;
      }
    } else {
      description += 'Files are saved in PCM format (48kHz, stereo).\n' +
        'You can convert them with ffmpeg:\n' +
        '```\nffmpeg -f s16le -ar 48000 -ac 2 -i input.pcm output.mp3\n```';
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Recording Stopped')
      .setDescription(description)
      .setFooter({ text: 'EXPERIMENTAL FEATURE' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
    logger.info(`Stopped recording in ${interaction.guild.name}`);
  } catch (error) {
    logger.error('Failed to stop recording:', error);
    await interaction.editReply({
      content: `Failed to stop recording: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function handleStatus(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const recorder = getVoiceRecorder();
  const isAvailable = VoiceRecorder.isAvailable();
  const hasFfmpeg = await VoiceRecorder.checkFfmpeg();

  const embed = new EmbedBuilder()
    .setColor(isAvailable ? 0x00ff00 : 0xff0000)
    .setTitle('Recording Status')
    .addFields(
      {
        name: 'Opus Support',
        value: isAvailable ? 'Available' : 'Not available',
        inline: true,
      },
      {
        name: 'FFmpeg',
        value: hasFfmpeg ? 'Available (MP3)' : 'Not found (PCM only)',
        inline: true,
      },
      {
        name: 'Connected',
        value: recorder.isConnected() ? 'Yes' : 'No',
        inline: true,
      },
      {
        name: 'Recording',
        value: recorder.isRecording() ? 'Yes' : 'No',
        inline: true,
      }
    )
    .setFooter({ text: 'EXPERIMENTAL FEATURE' })
    .setTimestamp();

  const recordingInfo = activeRecordings.get(interaction.guild.id);
  if (recordingInfo) {
    const duration = Math.floor(
      (Date.now() - recordingInfo.startedAt.getTime()) / 1000
    );
    embed.addFields(
      {
        name: 'Recording Duration',
        value: formatDuration(duration),
        inline: true,
      },
      {
        name: 'Output Directory',
        value: `\`${recordingInfo.outputDir}\``,
        inline: false,
      }
    );
  }

  if (!isAvailable) {
    embed.setDescription(
      'To enable recording, install dependencies:\n```\nnpm install prism-media opusscript\n```'
    );
  }

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  } else {
    return `${secs}s`;
  }
}
