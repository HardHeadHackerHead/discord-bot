import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  VoiceChannel,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { ServerStatsService, StatType } from '../services/ServerStatsService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('ServerStats:Command');

let statsService: ServerStatsService | null = null;

export function setServerStatsService(service: ServerStatsService): void {
  statsService = service;
}

const STAT_TYPE_DESCRIPTIONS: Record<StatType, string> = {
  members: 'Total member count',
  online: 'Online member count',
  bots: 'Bot count',
  humans: 'Human member count',
  channels: 'Channel count',
  roles: 'Role count',
};

const STAT_TYPE_DEFAULTS: Record<StatType, string> = {
  members: 'Members: {count}',
  online: 'Online: {count}',
  bots: 'Bots: {count}',
  humans: 'Humans: {count}',
  channels: 'Channels: {count}',
  roles: 'Roles: {count}',
};

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('serverstats')
    .setDescription('Manage server stat display channels')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(subcommand =>
      subcommand
        .setName('create')
        .setDescription('Create a new stats display channel')
        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('What stat to display')
            .setRequired(true)
            .addChoices(
              { name: 'Members - Total member count', value: 'members' },
              { name: 'Online - Online member count', value: 'online' },
              { name: 'Bots - Bot count', value: 'bots' },
              { name: 'Humans - Human member count', value: 'humans' },
              { name: 'Channels - Channel count', value: 'channels' },
              { name: 'Roles - Role count', value: 'roles' }
            )
        )
        .addStringOption(option =>
          option
            .setName('template')
            .setDescription('Channel name template (use {count} for the number)')
            .setRequired(false)
            .setMaxLength(100)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('delete')
        .setDescription('Delete a stats display channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('The stats channel to delete')
            .addChannelTypes(ChannelType.GuildVoice)
            .setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('list')
        .setDescription('List all stats display channels in this server')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('refresh')
        .setDescription('Manually refresh all stats channels')
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!statsService) {
      await interaction.reply({
        content: '❌ Server Stats service is not initialized.',
        ephemeral: true,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
      case 'create':
        await handleCreate(interaction, statsService);
        break;
      case 'delete':
        await handleDelete(interaction, statsService);
        break;
      case 'list':
        await handleList(interaction, statsService);
        break;
      case 'refresh':
        await handleRefresh(interaction, statsService);
        break;
    }
  },
};

/**
 * Handle /serverstats create - Create a stats channel
 */
async function handleCreate(
  interaction: ChatInputCommandInteraction,
  service: ServerStatsService
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const statType = interaction.options.getString('type', true) as StatType;
  const template = interaction.options.getString('template') || STAT_TYPE_DEFAULTS[statType];

  if (!interaction.guild) {
    await interaction.editReply({ content: '❌ This command can only be used in a server.' });
    return;
  }

  try {
    // Create a voice channel that cannot be joined
    const channel = await interaction.guild.channels.create({
      name: service.formatChannelName(template, service.getStatValue(interaction.guild, statType)),
      type: ChannelType.GuildVoice,
      permissionOverwrites: [
        {
          id: interaction.guild.roles.everyone.id,
          deny: ['Connect'],
        },
      ],
    });

    // Save to database
    await service.createStatsChannel(
      interaction.guildId!,
      channel.id,
      statType,
      template
    );

    logger.info(`Stats channel created: ${statType} in ${interaction.guild.name}`);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📊 Stats Channel Created')
          .setDescription(`Created ${channel} to display **${STAT_TYPE_DESCRIPTIONS[statType]}**.`)
          .addFields(
            { name: 'Stat Type', value: statType, inline: true },
            { name: 'Template', value: `\`${template}\``, inline: true }
          )
          .setColor(0x57F287)
          .setFooter({ text: 'The channel will update automatically when members join/leave' }),
      ],
    });
  } catch (error) {
    logger.error('Failed to create stats channel:', error);
    await interaction.editReply({
      content: '❌ Failed to create stats channel. Make sure I have permission to create channels.',
    });
  }
}

/**
 * Handle /serverstats delete - Delete a stats channel
 */
async function handleDelete(
  interaction: ChatInputCommandInteraction,
  service: ServerStatsService
): Promise<void> {
  const channel = interaction.options.getChannel('channel', true) as VoiceChannel;

  // Check if it's a stats channel
  const statsChannel = await service.getStatsChannel(channel.id);
  if (!statsChannel) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`❌ ${channel} is not a stats channel.`)
          .setColor(0xED4245),
      ],
      ephemeral: true,
    });
    return;
  }

  try {
    // Delete from database
    await service.deleteStatsChannel(channel.id);

    // Delete the Discord channel
    await channel.delete('Stats channel removed via /serverstats delete');

    logger.info(`Stats channel deleted: ${statsChannel.stat_type} in ${interaction.guild?.name}`);

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`✅ Deleted the **${statsChannel.stat_type}** stats channel.`)
          .setColor(0x57F287),
      ],
      ephemeral: true,
    });
  } catch (error) {
    logger.error('Failed to delete stats channel:', error);
    await interaction.reply({
      content: '❌ Failed to delete stats channel. Please delete it manually.',
      ephemeral: true,
    });
  }
}

/**
 * Handle /serverstats list - List all stats channels
 */
async function handleList(
  interaction: ChatInputCommandInteraction,
  service: ServerStatsService
): Promise<void> {
  const channels = await service.getGuildStatsChannels(interaction.guildId!);

  if (channels.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('📊 Stats Channels')
          .setDescription('No stats channels have been set up yet.\n\nUse `/serverstats create` to create one.')
          .setColor(0x5865F2),
      ],
      ephemeral: true,
    });
    return;
  }

  const channelList = channels.map(c => {
    return `<#${c.channel_id}>\n└ Type: \`${c.stat_type}\` | Template: \`${c.name_template}\``;
  }).join('\n\n');

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('📊 Stats Channels')
        .setDescription(channelList)
        .setColor(0x5865F2)
        .setFooter({ text: `${channels.length} stats channel(s) configured` }),
    ],
    ephemeral: true,
  });
}

/**
 * Handle /serverstats refresh - Manually refresh stats
 */
async function handleRefresh(
  interaction: ChatInputCommandInteraction,
  service: ServerStatsService
): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    await service.updateGuildStats(interaction.client, interaction.guildId!);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setDescription('✅ All stats channels have been refreshed.')
          .setColor(0x57F287),
      ],
    });
  } catch (error) {
    logger.error('Failed to refresh stats:', error);
    await interaction.editReply({
      content: '❌ Failed to refresh some stats channels.',
    });
  }
}
