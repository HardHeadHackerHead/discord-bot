import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  TextChannel,
  ComponentType,
} from 'discord.js';
import { defineSlashCommand } from '../../../types/command.types.js';
import { successEmbed, errorEmbed, warningEmbed } from '../../../shared/utils/embed.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Admin:Clear');

/**
 * /clear command - Clear all messages in a channel
 */
export const command = defineSlashCommand(
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Clear all messages in this channel (requires confirmation)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator) as SlashCommandBuilder,

  async (interaction: ChatInputCommandInteraction) => {
    const channel = interaction.channel;

    if (!channel || !(channel instanceof TextChannel)) {
      await interaction.reply({
        embeds: [errorEmbed('Invalid Channel', 'This command can only be used in text channels.')],
        ephemeral: true,
      });
      return;
    }

    // Check bot permissions
    const botMember = interaction.guild?.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageMessages)) {
      await interaction.reply({
        embeds: [errorEmbed('Missing Permissions', 'I need the **Manage Messages** permission to clear messages.')],
        ephemeral: true,
      });
      return;
    }

    // Create confirmation buttons
    const confirmRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('clear_confirm')
        .setLabel('Yes, Clear All Messages')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('clear_cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    const response = await interaction.reply({
      embeds: [
        warningEmbed(
          'Confirm Channel Clear',
          `Are you sure you want to delete **all messages** in ${channel}?\n\n` +
          `⚠️ **This action cannot be undone!**\n\n` +
          `Note: Discord only allows bulk deletion of messages less than 14 days old. ` +
          `Older messages will be skipped.`
        ),
      ],
      components: [confirmRow],
      ephemeral: true,
    });

    // Wait for button interaction
    try {
      const buttonInteraction = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: 30_000, // 30 seconds to confirm
      });

      if (buttonInteraction.customId === 'clear_cancel') {
        await buttonInteraction.update({
          embeds: [successEmbed('Cancelled', 'Channel clear has been cancelled.')],
          components: [],
        });
        return;
      }

      // User confirmed - start clearing
      await buttonInteraction.update({
        embeds: [warningEmbed('Clearing Messages', 'Deleting messages... This may take a while.')],
        components: [],
      });

      let totalDeleted = 0;
      let hasMoreMessages = true;

      while (hasMoreMessages) {
        // Fetch messages in batches of 100 (Discord limit)
        const messages = await channel.messages.fetch({ limit: 100 });

        if (messages.size === 0) {
          hasMoreMessages = false;
          break;
        }

        // Filter messages that can be bulk deleted (< 14 days old)
        const fourteenDaysAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const deletableMessages = messages.filter((msg) => msg.createdTimestamp > fourteenDaysAgo);

        if (deletableMessages.size === 0) {
          // No more messages that can be bulk deleted
          hasMoreMessages = false;
          break;
        }

        try {
          const deleted = await channel.bulkDelete(deletableMessages, true);
          totalDeleted += deleted.size;

          // If we deleted fewer than we fetched, there might be old messages we can't delete
          if (deleted.size < messages.size) {
            hasMoreMessages = false;
          }

          // Small delay to avoid rate limits
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (error) {
          logger.error('Error during bulk delete:', error);
          hasMoreMessages = false;
        }
      }

      logger.info(`Cleared ${totalDeleted} messages in #${channel.name} (${channel.id}) by ${interaction.user.tag}`);

      await interaction.editReply({
        embeds: [
          successEmbed(
            'Channel Cleared',
            `Successfully deleted **${totalDeleted.toLocaleString()}** messages.\n\n` +
            `Note: Messages older than 14 days cannot be bulk deleted due to Discord limitations.`
          ),
        ],
        components: [],
      });
    } catch (error) {
      // Timeout or other error
      if ((error as Error).name === 'Error' && (error as Error).message.includes('time')) {
        await interaction.editReply({
          embeds: [errorEmbed('Timed Out', 'Confirmation timed out. No messages were deleted.')],
          components: [],
        });
      } else {
        logger.error('Error in clear command:', error);
        await interaction.editReply({
          embeds: [errorEmbed('Error', 'An error occurred while clearing messages.')],
          components: [],
        });
      }
    }
  },
  {
    guildOnly: true,
  }
);
