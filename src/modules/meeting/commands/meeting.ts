import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
  VoiceChannel,
  AttachmentBuilder,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { Logger } from '../../../shared/utils/logger.js';
import { VoiceRecorder, getVoiceRecorder } from '../../../core/voice/VoiceRecorder.js';
import {
  startMeeting,
  stopMeeting,
  getMeeting,
  checkProviders,
  getProviderInfo,
  formatTranscript,
  formatTranscriptPlain,
  playRecordingAnnouncement,
} from '../services/MeetingService.js';

const logger = new Logger('Meeting:Command');

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('meeting')
    .setDescription('Record voice channel meetings with transcription and AI summaries')
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('Start recording a meeting')
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop the meeting recording')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Check meeting recording status')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages),

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

async function handleStart(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const member = interaction.member as GuildMember;
  const voiceChannel = member.voice.channel;

  if (!voiceChannel || !(voiceChannel instanceof VoiceChannel)) {
    await interaction.reply({
      content: 'You need to be in a voice channel first!',
      ephemeral: true,
    });
    return;
  }

  // Check if voice recording is available
  if (!VoiceRecorder.isAvailable()) {
    await interaction.reply({
      content:
        '**Meeting recording is not available.**\n\n' +
        'Missing audio dependencies.\n' +
        'Run: `npm install prism-media opusscript`',
      ephemeral: true,
    });
    return;
  }

  // Check if providers are configured
  const providers = checkProviders();
  if (!providers.transcription) {
    await interaction.reply({
      content:
        '**Meeting recording is not available.**\n\n' +
        'No transcription provider configured.\n' +
        'Set `OPENAI_API_KEY` or `GOOGLE_SPEECH_API_KEY` in your environment.',
      ephemeral: true,
    });
    return;
  }

  // Check if there's already an active meeting
  const existingSession = getMeeting(interaction.guild.id);
  if (existingSession) {
    await interaction.reply({
      content: `A meeting is already being recorded by <@${existingSession.hostId}>.\nUse \`/meeting stop\` to end it first.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const recorder = getVoiceRecorder();

    // Join the voice channel if not already connected
    if (!recorder.isConnected()) {
      const joined = await recorder.joinChannel(voiceChannel);
      if (!joined) {
        await interaction.editReply({
          content: 'Failed to join voice channel. Check bot permissions.',
        });
        return;
      }
    }

    // Get the text channel for output
    const textChannel = interaction.channel as TextChannel;
    if (!textChannel || !('send' in textChannel)) {
      await interaction.editReply({
        content: 'Cannot send messages in this channel.',
      });
      recorder.disconnect();
      return;
    }

    // Start the meeting
    const session = await startMeeting(
      interaction.user,
      interaction.guild.id,
      voiceChannel,
      textChannel,
      recorder,
      interaction.client
    );

    if (!session) {
      await interaction.editReply({
        content: 'Failed to start meeting recording. Check the logs for details.',
      });
      recorder.disconnect();
      return;
    }

    // Get participant list
    const participantList = Array.from(session.participants.values())
      .map(p => p.user.displayName)
      .join(', ') || 'None';

    const embed = new EmbedBuilder()
      .setColor(0xff0000) // Red to indicate recording
      .setTitle('Meeting Recording Started')
      .setDescription(
        `Recording meeting in **${voiceChannel.name}**\n\n` +
          '**What happens:**\n' +
          '• All speech is being recorded and transcribed\n' +
          '• An AI summary will be generated when the meeting ends\n' +
          '• Use `/meeting stop` to end recording\n\n' +
          `**Participants:** ${participantList}`
      )
      .setFooter({ text: 'EXPERIMENTAL FEATURE' })
      .setTimestamp();

    const reply = await interaction.editReply({ embeds: [embed] });

    // Store the message ID so we can delete it when meeting ends
    session.startMessageId = reply.id;

    // Play recording announcement
    await playRecordingAnnouncement(session);

    // Also send a message in chat about recording
    await textChannel.send({
      content: `**Recording in progress.** This meeting is being recorded and transcribed.`,
    });

    logger.info(`Meeting recording started by ${interaction.user.tag}`);
  } catch (error) {
    logger.error('Failed to start meeting:', error);
    await interaction.editReply({
      content: `Failed to start: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function handleStop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const session = getMeeting(interaction.guild.id);

  if (!session) {
    await interaction.reply({
      content: 'No active meeting recording.',
      ephemeral: true,
    });
    return;
  }

  // Only the host or admins can stop
  const member = interaction.member as GuildMember;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  if (session.hostId !== interaction.user.id && !isAdmin) {
    await interaction.reply({
      content: `Only <@${session.hostId}> or an admin can stop this meeting.`,
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply();

  try {
    // Delete the "recording started" message if it exists
    if (session.startMessageId && session.textChannel) {
      try {
        const startMessage = await session.textChannel.messages.fetch(session.startMessageId);
        await startMessage.delete();
      } catch {
        // Message may already be deleted, ignore
      }
    }

    // Stop the meeting
    const result = await stopMeeting(interaction.guild.id);

    // Disconnect from voice
    const recorder = getVoiceRecorder();
    recorder.disconnect();

    if (!result) {
      await interaction.editReply({
        content: 'Failed to stop meeting. It may have already ended.',
      });
      return;
    }

    const { duration, summary } = result;
    const participantCount = session.participants.size;
    const transcriptEntries = session.transcript.length;

    // Build the summary embed
    let description = `Meeting in **${session.voiceChannelName}** has ended.\n\n` +
      `**Duration:** ${formatDuration(duration)}\n` +
      `**Participants:** ${participantCount}\n` +
      `**Speech segments recorded:** ${transcriptEntries}`;

    // Create the main embed
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Meeting Recording Complete')
      .setDescription(description)
      .setFooter({ text: 'EXPERIMENTAL FEATURE' })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    // Send AI summary if available
    if (summary) {
      const summaryEmbed = new EmbedBuilder()
        .setColor(0x00ff00)
        .setTitle('Meeting Summary')
        .setDescription(summary)
        .setTimestamp();

      await interaction.followUp({ embeds: [summaryEmbed] });
    }

    // Send transcript if there are entries
    if (session.transcript.length > 0) {
      const transcriptMarkdown = formatTranscript(session.transcript);
      const transcriptPlain = formatTranscriptPlain(session.transcript);

      // Always create a text file attachment
      const timestamp = new Date().toISOString().split('T')[0];
      const fileName = `meeting-transcript-${timestamp}.txt`;
      const fileBuffer = Buffer.from(transcriptPlain, 'utf-8');
      const attachment = new AttachmentBuilder(fileBuffer, { name: fileName });

      // Only show embed if it fits (under 4000 chars), otherwise just attach file
      if (transcriptMarkdown.length <= 4000) {
        const transcriptEmbed = new EmbedBuilder()
          .setColor(0x95a5a6)
          .setTitle('Meeting Transcript')
          .setDescription(transcriptMarkdown)
          .setTimestamp();

        await interaction.followUp({ embeds: [transcriptEmbed], files: [attachment] });
      } else {
        // Too long for embed, just send the file
        await interaction.followUp({
          content: '**Meeting Transcript** (too long for embed, see attached file)',
          files: [attachment],
        });
      }
    }

    logger.info(`Meeting stopped by ${interaction.user.tag}`);
  } catch (error) {
    logger.error('Failed to stop meeting:', error);
    await interaction.editReply({
      content: `Failed to stop meeting: ${error instanceof Error ? error.message : 'Unknown error'}`,
    });
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  const voiceAvailable = VoiceRecorder.isAvailable();
  const hasFfmpeg = await VoiceRecorder.checkFfmpeg();
  const providers = checkProviders();
  const providerInfo = getProviderInfo();
  const session = getMeeting(interaction.guild.id);

  const allReady = voiceAvailable && hasFfmpeg && providers.transcription;

  const embed = new EmbedBuilder()
    .setColor(allReady ? 0x00ff00 : 0xff0000)
    .setTitle('Meeting Recording Status')
    .addFields(
      {
        name: 'Opus Support',
        value: voiceAvailable ? '✅ Available' : '❌ Not available',
        inline: true,
      },
      {
        name: 'FFmpeg',
        value: hasFfmpeg ? '✅ Available' : '❌ Not found',
        inline: true,
      },
      {
        name: 'Transcription',
        value: providerInfo.transcription.configured
          ? `✅ ${providerInfo.transcription.provider}`
          : '❌ Not configured',
        inline: true,
      },
      {
        name: 'AI Summary',
        value: providerInfo.ai.configured
          ? `✅ ${providerInfo.ai.provider}`
          : '⚠️ Not configured (no summaries)',
        inline: true,
      },
      {
        name: 'Announcements',
        value: providerInfo.tts.configured
          ? `✅ ${providerInfo.tts.provider}`
          : '⚠️ Not configured (text only)',
        inline: true,
      }
    )
    .setFooter({ text: 'EXPERIMENTAL FEATURE' })
    .setTimestamp();

  if (session) {
    const duration = Math.floor((Date.now() - session.startedAt.getTime()) / 1000);
    embed.addFields(
      {
        name: 'Active Recording',
        value: `In **${session.voiceChannelName}**`,
        inline: true,
      },
      {
        name: 'Host',
        value: `<@${session.hostId}>`,
        inline: true,
      },
      {
        name: 'Duration',
        value: formatDuration(duration),
        inline: true,
      },
      {
        name: 'Participants',
        value: `${session.participants.size}`,
        inline: true,
      },
      {
        name: 'Transcribed Segments',
        value: `${session.transcript.length}`,
        inline: true,
      }
    );
  } else {
    embed.addFields({
      name: 'Active Recording',
      value: 'None',
      inline: false,
    });
  }

  if (!allReady) {
    let missing = '';
    if (!voiceAvailable) missing += '• Run: `npm install prism-media opusscript`\n';
    if (!hasFfmpeg) missing += '• Install FFmpeg\n';
    if (!providers.transcription) missing += '• Set `OPENAI_API_KEY` for transcription\n';

    embed.setDescription(`**Missing requirements:**\n${missing}`);
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

