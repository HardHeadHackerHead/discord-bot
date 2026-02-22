import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  TextChannel,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { PollsService } from '../services/PollsService.js';
import { PollsPanel } from '../components/PollsPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('Polls:Command');

let pollsService: PollsService | null = null;

export function setPollsService(service: PollsService): void {
  pollsService = service;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Create and manage polls')
    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a new poll')
        .addStringOption(opt =>
          opt
            .setName('title')
            .setDescription('The poll question/title')
            .setRequired(true)
            .setMaxLength(255)
        )
        .addStringOption(opt =>
          opt
            .setName('options')
            .setDescription('Poll options separated by | (e.g., Option 1 | Option 2 | Option 3)')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('description')
            .setDescription('Additional description for the poll')
            .setRequired(false)
            .setMaxLength(1000)
        )
        .addIntegerOption(opt =>
          opt
            .setName('duration')
            .setDescription('Duration in minutes (0 = no limit)')
            .setRequired(false)
            .setMinValue(0)
            .setMaxValue(10080) // Max 1 week
        )
        .addBooleanOption(opt =>
          opt
            .setName('multiple')
            .setDescription('Allow multiple votes per user')
            .setRequired(false)
        )
        .addBooleanOption(opt =>
          opt
            .setName('anonymous')
            .setDescription('Hide who voted for what')
            .setRequired(false)
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Channel to post the poll in (defaults to current)')
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('end')
        .setDescription('End an active poll')
        .addStringOption(opt =>
          opt
            .setName('poll_id')
            .setDescription('The poll ID (from the embed footer)')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List active polls in this server')
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!pollsService) {
      await interaction.reply({
        content: 'Polls service is not available.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create':
        await handleCreate(interaction, pollsService);
        break;
      case 'end':
        await handleEnd(interaction, pollsService);
        break;
      case 'list':
        await handleList(interaction, pollsService);
        break;
    }
  },
};

async function handleCreate(
  interaction: ChatInputCommandInteraction,
  service: PollsService
): Promise<void> {
  const title = interaction.options.getString('title', true);
  const optionsStr = interaction.options.getString('options', true);
  const description = interaction.options.getString('description');
  const duration = interaction.options.getInteger('duration') || 0;
  const allowMultiple = interaction.options.getBoolean('multiple') || false;
  const anonymous = interaction.options.getBoolean('anonymous') || false;
  const targetChannel = interaction.options.getChannel('channel') as TextChannel | null;

  const guild = interaction.guild!;
  const channel = targetChannel || (interaction.channel as TextChannel);

  // Parse options
  const optionLabels = optionsStr.split('|').map(o => o.trim()).filter(o => o.length > 0);

  if (optionLabels.length < 2) {
    await interaction.reply({
      embeds: [PollsPanel.createErrorEmbed(
        'Invalid Options',
        'Please provide at least 2 options separated by `|`'
      )],
      ephemeral: true,
    });
    return;
  }

  if (optionLabels.length > 25) {
    await interaction.reply({
      embeds: [PollsPanel.createErrorEmbed(
        'Too Many Options',
        'Maximum 25 options allowed.'
      )],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // Create the poll
    const poll = await service.createPoll({
      guildId: guild.id,
      channelId: channel.id,
      creatorId: interaction.user.id,
      title,
      description: description || undefined,
      pollType: 'standard',
      options: optionLabels.map(label => ({ label })),
      allowMultiple,
      anonymous,
      durationSeconds: duration > 0 ? duration * 60 : undefined,
    });

    if (!poll) {
      await interaction.editReply({
        embeds: [PollsPanel.createErrorEmbed(
          'Creation Failed',
          'Failed to create the poll. Please try again.'
        )],
      });
      return;
    }

    // Get options for the embed
    const options = await service.getPollOptionsWithVotes(poll.id);

    // Send the poll message
    const embed = PollsPanel.createPollEmbed(poll, options, 0);
    const components = PollsPanel.createVoteComponents(poll, options);

    const pollMessage = await channel.send({
      embeds: [embed],
      components,
    });

    // Store the message ID
    await service.setMessageId(poll.id, pollMessage.id);

    await interaction.editReply({
      embeds: [PollsPanel.createSuccessEmbed(
        'Poll Created',
        `Your poll has been created in ${channel}.\n\nPoll ID: \`${poll.id}\``
      )],
    });

    logger.info(`Poll "${title}" created by ${interaction.user.username} in ${guild.name}`);
  } catch (error) {
    logger.error('Error creating poll:', error);
    await interaction.editReply({
      embeds: [PollsPanel.createErrorEmbed(
        'Error',
        'An error occurred while creating the poll.'
      )],
    });
  }
}

async function handleEnd(
  interaction: ChatInputCommandInteraction,
  service: PollsService
): Promise<void> {
  const pollId = interaction.options.getString('poll_id', true);

  const poll = await service.getPoll(pollId);

  if (!poll) {
    await interaction.reply({
      embeds: [PollsPanel.createErrorEmbed(
        'Not Found',
        'Could not find a poll with that ID.'
      )],
      ephemeral: true,
    });
    return;
  }

  if (poll.guild_id !== interaction.guildId) {
    await interaction.reply({
      embeds: [PollsPanel.createErrorEmbed(
        'Not Found',
        'Could not find a poll with that ID in this server.'
      )],
      ephemeral: true,
    });
    return;
  }

  if (poll.status !== 'active') {
    await interaction.reply({
      embeds: [PollsPanel.createInfoEmbed(
        'Already Ended',
        'This poll has already ended.'
      )],
      ephemeral: true,
    });
    return;
  }

  // Check if user is creator or has manage messages permission
  const member = interaction.member;
  const isCreator = poll.creator_id === interaction.user.id;
  const hasPermission = member &&
    typeof member.permissions !== 'string' &&
    member.permissions.has(PermissionFlagsBits.ManageMessages);

  if (!isCreator && !hasPermission) {
    await interaction.reply({
      embeds: [PollsPanel.createErrorEmbed(
        'Permission Denied',
        'Only the poll creator or moderators can end this poll.'
      )],
      ephemeral: true,
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    // End the poll
    await service.endPoll(pollId);

    // Update the poll message
    const options = await service.getPollOptionsWithVotes(pollId);
    const totalVoters = await service.getTotalVotes(pollId);
    const winners = await service.getWinners(pollId);

    const resultsEmbed = PollsPanel.createResultsEmbed(poll, options, totalVoters, winners);

    // Try to update the original message
    if (poll.message_id) {
      try {
        const channel = await interaction.guild!.channels.fetch(poll.channel_id);
        if (channel && channel.isTextBased() && 'messages' in channel) {
          const message = await (channel as TextChannel).messages.fetch(poll.message_id);
          await message.edit({
            embeds: [resultsEmbed],
            components: PollsPanel.createDisabledComponents(),
          });
        }
      } catch (error) {
        logger.debug('Could not update poll message:', error);
      }
    }

    await interaction.editReply({
      embeds: [PollsPanel.createSuccessEmbed(
        'Poll Ended',
        `The poll has been ended. ${winners.length > 0 ? `Winner: **${winners.map(w => w.label).join(', ')}**` : 'No votes were cast.'}`
      )],
    });

    logger.info(`Poll ${pollId} ended by ${interaction.user.username}`);
  } catch (error) {
    logger.error('Error ending poll:', error);
    await interaction.editReply({
      embeds: [PollsPanel.createErrorEmbed(
        'Error',
        'An error occurred while ending the poll.'
      )],
    });
  }
}

async function handleList(
  interaction: ChatInputCommandInteraction,
  service: PollsService
): Promise<void> {
  const activePolls = await service.getActivePolls(interaction.guildId!);

  if (activePolls.length === 0) {
    await interaction.reply({
      embeds: [PollsPanel.createInfoEmbed(
        'No Active Polls',
        'There are no active polls in this server.'
      )],
      ephemeral: true,
    });
    return;
  }

  const pollList = activePolls.map(poll => {
    let line = `**${poll.title}**`;
    line += `\nID: \`${poll.id}\``;
    line += `\nChannel: <#${poll.channel_id}>`;
    if (poll.ends_at) {
      const endsAt = new Date(poll.ends_at);
      line += `\nEnds: <t:${Math.floor(endsAt.getTime() / 1000)}:R>`;
    }
    return line;
  }).join('\n\n');

  await interaction.reply({
    embeds: [PollsPanel.createInfoEmbed(
      `Active Polls (${activePolls.length})`,
      pollList
    )],
    ephemeral: true,
  });
}
