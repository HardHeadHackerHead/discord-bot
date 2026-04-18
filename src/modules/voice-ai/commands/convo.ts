import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { Logger } from '../../../shared/utils/logger.js';
import { VoiceRecorder, getVoiceRecorder } from '../../../core/voice/VoiceRecorder.js';
import {
  startConversation,
  stopConversation,
  getConversation,
  checkProviders,
  getProviderInfo,
  formatChatLog,
} from '../services/VoiceAIService.js';

const logger = new Logger('VoiceAI:Command');

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('convo')
    .setDescription('Start a voice conversation with AI')
    .addSubcommand((sub) =>
      sub.setName('start').setDescription('Start a voice conversation with AI')
    )
    .addSubcommand((sub) =>
      sub.setName('stop').setDescription('Stop the voice conversation')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Check voice AI status')
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

  if (!voiceChannel) {
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
        '**Voice AI is not available.**\n\n' +
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
        '**Voice AI is not available.**\n\n' +
        'No transcription provider configured.\n' +
        'Set `OPENAI_API_KEY` or `GOOGLE_SPEECH_API_KEY` in your environment.',
      ephemeral: true,
    });
    return;
  }

  if (!providers.ai) {
    await interaction.reply({
      content:
        '**Voice AI is not available.**\n\n' +
        'No AI provider configured.\n' +
        'Set `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` in your environment.',
      ephemeral: true,
    });
    return;
  }

  // Check if there's already an active conversation
  const existingSession = getConversation(interaction.guild.id);
  if (existingSession) {
    await interaction.reply({
      content: `A voice conversation is already active with <@${existingSession.userId}>.\nUse \`/convo stop\` to end it first.`,
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

    // Get the text channel for responses
    const textChannel = interaction.channel as TextChannel;
    if (!textChannel || !('send' in textChannel)) {
      await interaction.editReply({
        content: 'Cannot send messages in this channel.',
      });
      recorder.disconnect();
      return;
    }

    // Start the conversation
    const session = await startConversation(
      interaction.user,
      interaction.guild.id,
      textChannel,
      recorder
    );

    if (!session) {
      await interaction.editReply({
        content: 'Failed to start voice conversation. Check the logs for details.',
      });
      recorder.disconnect();
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0x00ff00)
      .setTitle('Voice Conversation Started')
      .setDescription(
        `**${interaction.user.displayName}**, I'm now listening to you in **${voiceChannel.name}**!\n\n` +
          '**How it works:**\n' +
          '• Speak naturally in the voice channel\n' +
          '• Wait for a moment of silence (I\'ll know you\'re done)\n' +
          '• Your speech will be transcribed and sent to AI\n' +
          '• The response will appear in this chat\n\n' +
          'Use `/convo stop` when you\'re done.'
      )
      .setFooter({ text: 'EXPERIMENTAL FEATURE' })
      .setTimestamp();

    const reply = await interaction.editReply({ embeds: [embed] });

    // Store the message ID so we can delete it when conversation ends
    session.startMessageId = reply.id;

    logger.info(`Voice conversation started for ${interaction.user.tag}`);
  } catch (error) {
    logger.error('Failed to start voice conversation:', error);
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

  const session = getConversation(interaction.guild.id);

  if (!session) {
    await interaction.reply({
      content: 'No active voice conversation.',
      ephemeral: true,
    });
    return;
  }

  // Only the user who started or admins can stop
  const member = interaction.member as GuildMember;
  const isAdmin = member.permissions.has(PermissionFlagsBits.Administrator);
  if (session.userId !== interaction.user.id && !isAdmin) {
    await interaction.reply({
      content: `Only <@${session.userId}> or an admin can stop this conversation.`,
      ephemeral: true,
    });
    return;
  }

  // Delete the "conversation started" message if it exists
  if (session.startMessageId && session.textChannel) {
    try {
      const startMessage = await session.textChannel.messages.fetch(session.startMessageId);
      await startMessage.delete();
    } catch {
      // Message may already be deleted, ignore
    }
  }

  // Stop the conversation
  const stoppedSession = stopConversation(interaction.guild.id);

  // Disconnect from voice
  const recorder = getVoiceRecorder();
  recorder.disconnect();

  const duration = stoppedSession
    ? Math.floor((Date.now() - stoppedSession.startedAt.getTime()) / 1000)
    : 0;

  const messageCount = stoppedSession?.chatLog.length || 0;
  const exchangeCount = Math.floor(messageCount / 2);

  // Build the conversation transcript
  let transcriptText = '';
  if (stoppedSession && stoppedSession.chatLog.length > 0) {
    transcriptText = formatChatLog(stoppedSession.chatLog, session.user.displayName);
  }

  // Build description with stats and transcript combined
  let description = `Conversation with **${session.user.displayName}** has ended.\n\n` +
    `**Duration:** ${formatDuration(duration)}\n` +
    `**Messages exchanged:** ${exchangeCount}`;

  // If transcript fits in one embed, include it
  const hasTranscript = transcriptText && transcriptText !== '*No messages exchanged*';
  const transcriptSection = hasTranscript ? `\n\n**Transcript:**\n${transcriptText}` : '';

  // Check if it all fits in one embed (Discord embed description limit is 4096)
  const combinedDescription = description + transcriptSection;
  const fitsInOneEmbed = combinedDescription.length <= 4000;

  if (fitsInOneEmbed && hasTranscript) {
    // Everything fits in one embed
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Voice Conversation Ended')
      .setDescription(combinedDescription)
      .setFooter({ text: 'EXPERIMENTAL FEATURE' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } else if (hasTranscript) {
    // Need to split: summary embed + transcript chunks
    const summaryEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Voice Conversation Ended')
      .setDescription(description)
      .setFooter({ text: 'EXPERIMENTAL FEATURE' })
      .setTimestamp();

    // Split transcript into chunks (leaving room for header in first chunk)
    const chunks = splitMessage(transcriptText, 3900);

    // First chunk goes with the summary
    const firstChunk = chunks.shift();
    if (firstChunk) {
      summaryEmbed.addFields({
        name: 'Transcript',
        value: firstChunk.length > 1024 ? firstChunk.slice(0, 1021) + '...' : firstChunk,
      });
    }

    await interaction.reply({ embeds: [summaryEmbed] });

    // Send remaining chunks as follow-ups
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk) continue;

      const transcriptEmbed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('Transcript (continued)')
        .setDescription(chunk)
        .setTimestamp();

      await interaction.followUp({ embeds: [transcriptEmbed] });
    }
  } else {
    // No transcript, just the summary
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Voice Conversation Ended')
      .setDescription(description + '\n\n*No messages exchanged*')
      .setFooter({ text: 'EXPERIMENTAL FEATURE' })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  }

  logger.info(`Voice conversation stopped for ${session.user.tag}`);
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
  const session = getConversation(interaction.guild.id);

  const allReady = voiceAvailable && hasFfmpeg && providers.transcription && providers.ai;

  const embed = new EmbedBuilder()
    .setColor(allReady ? 0x00ff00 : 0xff0000)
    .setTitle('Voice AI Status')
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
        name: 'AI Provider',
        value: providerInfo.ai.configured
          ? `✅ ${providerInfo.ai.provider}`
          : '❌ Not configured',
        inline: true,
      },
      {
        name: 'Text-to-Speech',
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
        name: 'Active Conversation',
        value: `With <@${session.userId}>`,
        inline: true,
      },
      {
        name: 'Duration',
        value: formatDuration(duration),
        inline: true,
      },
      {
        name: 'Messages',
        value: `${session.clipCount}`,
        inline: true,
      }
    );
  } else {
    embed.addFields({
      name: 'Active Conversation',
      value: 'None',
      inline: false,
    });
  }

  if (!allReady) {
    let missing = '';
    if (!voiceAvailable) missing += '• Run: `npm install prism-media opusscript`\n';
    if (!hasFfmpeg) missing += '• Install FFmpeg\n';
    if (!providers.transcription) missing += '• Set `GOOGLE_SPEECH_API_KEY`\n';
    if (!providers.ai) missing += '• Set `ANTHROPIC_API_KEY`\n';

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

/**
 * Split a message into chunks that fit within Discord's character limit
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  const paragraphs = text.split('\n\n');
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 <= maxLength) {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      // If single paragraph is too long, split it further
      if (paragraph.length > maxLength) {
        const words = paragraph.split(' ');
        currentChunk = '';
        for (const word of words) {
          if (currentChunk.length + word.length + 1 <= maxLength) {
            currentChunk += (currentChunk ? ' ' : '') + word;
          } else {
            if (currentChunk) chunks.push(currentChunk);
            currentChunk = word;
          }
        }
      } else {
        currentChunk = paragraph;
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks;
}
