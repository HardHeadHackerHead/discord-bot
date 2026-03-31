import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  TextChannel,
  Collection,
  Message,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { successEmbed, errorEmbed, loadingEmbed, createEmbed, COLORS } from '../../../shared/utils/embed.js';
import { chat, getAIRegistry } from '../../../core/ai/index.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Admin:Summarize');

const MAX_MESSAGES = 100;
const DEFAULT_MESSAGES = 10;

/**
 * /summarize command - Summarize recent messages in a channel using AI
 */
export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('summarize')
    .setDescription('Summarize recent messages in this channel using AI')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addIntegerOption((option) =>
      option
        .setName('count')
        .setDescription(`Number of messages to summarize (default: ${DEFAULT_MESSAGES}, max: ${MAX_MESSAGES})`)
        .setMinValue(1)
        .setMaxValue(MAX_MESSAGES)
        .setRequired(false)
    ) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    const channel = interaction.channel;

    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.reply({
        embeds: [errorEmbed('Invalid Channel', 'This command can only be used in text channels.')],
        ephemeral: true,
      });
      return;
    }

    // Check AI provider availability
    if (!getAIRegistry().hasConfiguredProvider()) {
      await interaction.reply({
        embeds: [errorEmbed('No AI Provider', 'No AI provider is configured. Set up an API key for Claude or OpenAI.')],
        ephemeral: true,
      });
      return;
    }

    const count = interaction.options.getInteger('count') ?? DEFAULT_MESSAGES;

    // Defer since this will take a moment
    await interaction.deferReply();

    try {
      // Fetch messages from the channel
      const messages: Collection<string, Message> = await channel.messages.fetch({ limit: count });

      if (messages.size === 0) {
        await interaction.editReply({
          embeds: [errorEmbed('No Messages', 'There are no messages in this channel to summarize.')],
        });
        return;
      }

      // Build conversation text from messages (oldest first)
      const sortedMessages = [...messages.values()].reverse();
      const conversationText = sortedMessages
        .map((msg) => {
          const author = msg.author.displayName || msg.author.username;
          const content = msg.content || '[embed/attachment]';
          return `${author}: ${content}`;
        })
        .join('\n');

      // Send to AI for summarization
      const aiResponse = await chat(conversationText, {
        systemPrompt:
          'You are a helpful assistant that summarizes Discord chat conversations. ' +
          'Provide a clear, concise summary of the conversation. ' +
          'Highlight the main topics discussed, key decisions or conclusions, and any action items. ' +
          'Keep the summary brief but informative. Use bullet points where appropriate. ' +
          'Do not include any preamble like "Here is a summary" — just provide the summary directly.',
        maxTokens: 1024,
        temperature: 0.3,
      });

      // Build the response embed
      const embed = createEmbed(COLORS.primary)
        .setTitle('Chat Summary')
        .setDescription(aiResponse.text)
        .addFields(
          { name: 'Messages', value: `${messages.size}`, inline: true },
          { name: 'Channel', value: `${channel}`, inline: true },
          { name: 'AI Provider', value: aiResponse.provider, inline: true },
        )
        .setFooter({ text: `Requested by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() });

      await interaction.editReply({ embeds: [embed] });

      logger.info(`Summarized ${messages.size} messages in #${channel.name} by ${interaction.user.tag}`);
    } catch (error) {
      logger.error('Error in summarize command:', error);
      await interaction.editReply({
        embeds: [errorEmbed('Summarization Failed', 'An error occurred while summarizing the chat. Please try again later.')],
      });
    }
  },
  {
    guildOnly: true,
  }
);
