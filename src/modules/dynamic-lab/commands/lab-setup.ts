import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  VoiceChannel,
  EmbedBuilder,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { LabService } from '../services/LabService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('DynamicLab:Command');

let labService: LabService | null = null;

export function setLabService(service: LabService): void {
  labService = service;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('lab')
    .setDescription('Configure your lab settings')
    // User settings subcommand (no permissions required)
    .addSubcommand(subcommand =>
      subcommand
        .setName('settings')
        .setDescription('View and configure your personal lab settings')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('name')
        .setDescription('Set your default lab name')
        .addStringOption(option =>
          option
            .setName('name')
            .setDescription('Your lab name (use @user for your display name)')
            .setRequired(true)
            .setMaxLength(100)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('limit')
        .setDescription('Set your default user limit')
        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Maximum users (0 for unlimited)')
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(99)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('lock')
        .setDescription('Set whether your lab starts locked by default')
        .addBooleanOption(option =>
          option
            .setName('locked')
            .setDescription('Start labs locked?')
            .setRequired(true)
        )
    )
    // Admin subcommands
    .addSubcommandGroup(group =>
      group
        .setName('admin')
        .setDescription('Admin commands for managing lab creators')
        .addSubcommand(subcommand =>
          subcommand
            .setName('add')
            .setDescription('Add an additional lab creator channel')
            .addChannelOption(option =>
              option
                .setName('channel')
                .setDescription('The voice channel that creates labs when joined')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true)
            )
            .addStringOption(option =>
              option
                .setName('default_name')
                .setDescription('Default lab name (use @user for the owner\'s name)')
                .setRequired(false)
            )
            .addIntegerOption(option =>
              option
                .setName('default_limit')
                .setDescription('Default user limit (0 for unlimited)')
                .setMinValue(0)
                .setMaxValue(99)
                .setRequired(false)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('remove')
            .setDescription('Remove a lab creator channel')
            .addChannelOption(option =>
              option
                .setName('channel')
                .setDescription('The voice channel to remove as a lab creator')
                .addChannelTypes(ChannelType.GuildVoice)
                .setRequired(true)
            )
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('list')
            .setDescription('List all lab creator channels in this server')
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!labService) {
      await interaction.reply({
        content: '❌ Lab service is not initialized.',
        ephemeral: true,
      });
      return;
    }

    const subcommandGroup = interaction.options.getSubcommandGroup(false);
    const subcommand = interaction.options.getSubcommand();

    // Handle admin commands
    if (subcommandGroup === 'admin') {
      // Check permissions for admin commands
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setDescription('❌ You need the "Manage Channels" permission to use admin commands.')
              .setColor(0xED4245),
          ],
          ephemeral: true,
        });
        return;
      }

      switch (subcommand) {
        case 'add':
          await handleAdminAdd(interaction, labService);
          break;
        case 'remove':
          await handleAdminRemove(interaction, labService);
          break;
        case 'list':
          await handleAdminList(interaction, labService);
          break;
      }
      return;
    }

    // Handle user commands
    switch (subcommand) {
      case 'settings':
        await handleSettings(interaction, labService);
        break;
      case 'name':
        await handleName(interaction, labService);
        break;
      case 'limit':
        await handleLimit(interaction, labService);
        break;
      case 'lock':
        await handleLock(interaction, labService);
        break;
    }
  },
};

// ==================== User Commands ====================

/**
 * Handle /lab settings - Show current settings
 */
async function handleSettings(
  interaction: ChatInputCommandInteraction,
  service: LabService
): Promise<void> {
  const settings = await service.getUserSettings(interaction.user.id, interaction.guildId!);

  const embed = new EmbedBuilder()
    .setTitle('🧪 Your Lab Settings')
    .setDescription('These settings are applied when you create a new lab.')
    .setColor(0x5865F2)
    .addFields(
      {
        name: 'Lab Name',
        value: settings?.lab_name || "@user's Lab *(default)*",
        inline: true,
      },
      {
        name: 'User Limit',
        value: settings?.user_limit !== undefined && settings.user_limit > 0
          ? `${settings.user_limit} users`
          : 'Unlimited *(default)*',
        inline: true,
      },
      {
        name: 'Start Locked',
        value: settings?.is_locked ? '🔒 Yes' : '🔓 No *(default)*',
        inline: true,
      },
    )
    .setFooter({ text: 'Use /lab name, /lab limit, or /lab lock to change settings' });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
}

/**
 * Handle /lab name - Set default lab name
 */
async function handleName(
  interaction: ChatInputCommandInteraction,
  service: LabService
): Promise<void> {
  const name = interaction.options.getString('name', true);

  await service.updateUserSettings(interaction.user.id, interaction.guildId!, {
    lab_name: name,
  });

  const previewName = name.replace('@user', interaction.user.displayName);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription(`✅ Your default lab name has been set to:\n**${name}**\n\nPreview: *${previewName}*`)
        .setColor(0x57F287)
        .setFooter({ text: 'This will apply to your next lab' }),
    ],
    ephemeral: true,
  });
}

/**
 * Handle /lab limit - Set default user limit
 */
async function handleLimit(
  interaction: ChatInputCommandInteraction,
  service: LabService
): Promise<void> {
  const limit = interaction.options.getInteger('limit', true);

  await service.updateUserSettings(interaction.user.id, interaction.guildId!, {
    user_limit: limit,
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription(`✅ Your default user limit has been set to: **${limit === 0 ? 'Unlimited' : `${limit} users`}**`)
        .setColor(0x57F287)
        .setFooter({ text: 'This will apply to your next lab' }),
    ],
    ephemeral: true,
  });
}

/**
 * Handle /lab lock - Set default lock state
 */
async function handleLock(
  interaction: ChatInputCommandInteraction,
  service: LabService
): Promise<void> {
  const locked = interaction.options.getBoolean('locked', true);

  await service.updateUserSettings(interaction.user.id, interaction.guildId!, {
    is_locked: locked,
  });

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription(`✅ Your labs will now start ${locked ? '🔒 **locked**' : '🔓 **unlocked**'} by default.`)
        .setColor(0x57F287)
        .setFooter({ text: 'This will apply to your next lab' }),
    ],
    ephemeral: true,
  });
}

// ==================== Admin Commands ====================

/**
 * Handle /lab admin add - Add a lab creator channel
 */
async function handleAdminAdd(
  interaction: ChatInputCommandInteraction,
  service: LabService
): Promise<void> {
  const channel = interaction.options.getChannel('channel', true) as VoiceChannel;
  const defaultName = interaction.options.getString('default_name') || "@user's Lab";
  const defaultLimit = interaction.options.getInteger('default_limit') || 0;

  // Check if channel is already a creator
  const existing = await service.getCreatorByChannel(channel.id);
  if (existing) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`⚠️ ${channel} is already a lab creator channel.`)
          .setColor(0xFEE75C),
      ],
      ephemeral: true,
    });
    return;
  }

  // Create the lab creator
  await service.createCreator(
    interaction.guildId!,
    channel.id,
    channel.parentId,
    {
      defaultName,
      defaultUserLimit: defaultLimit,
    }
  );

  logger.info(`Lab creator added: ${channel.name} in ${interaction.guild?.name}`);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('🧪 Lab Creator Added')
        .setDescription(`${channel} is now a lab creator channel.`)
        .addFields(
          { name: 'Default Name', value: defaultName, inline: true },
          { name: 'Default Limit', value: defaultLimit === 0 ? 'Unlimited' : String(defaultLimit), inline: true },
        )
        .setColor(0x57F287)
        .setFooter({ text: 'Users who join this channel will get their own lab' }),
    ],
  });
}

/**
 * Handle /lab admin remove - Remove a lab creator channel
 */
async function handleAdminRemove(
  interaction: ChatInputCommandInteraction,
  service: LabService
): Promise<void> {
  const channel = interaction.options.getChannel('channel', true) as VoiceChannel;

  // Check if channel is a creator
  const existing = await service.getCreatorByChannel(channel.id);
  if (!existing) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setDescription(`❌ ${channel} is not a lab creator channel.`)
          .setColor(0xED4245),
      ],
      ephemeral: true,
    });
    return;
  }

  // Remove the creator
  await service.removeCreator(channel.id);

  logger.info(`Lab creator removed: ${channel.name} in ${interaction.guild?.name}`);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setDescription(`✅ ${channel} is no longer a lab creator channel.`)
        .setColor(0x57F287),
    ],
  });
}

/**
 * Handle /lab admin list - List all lab creator channels
 */
async function handleAdminList(
  interaction: ChatInputCommandInteraction,
  service: LabService
): Promise<void> {
  const creators = await service.getCreatorsByGuild(interaction.guildId!);

  if (creators.length === 0) {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle('🧪 Lab Creators')
          .setDescription('No lab creator channels have been set up yet.\n\nThe bot should automatically create one, or use `/lab admin add` to add one manually.')
          .setColor(0x5865F2),
      ],
      ephemeral: true,
    });
    return;
  }

  const creatorList = creators.map(c => {
    const limit = c.default_user_limit === 0 ? 'Unlimited' : String(c.default_user_limit);
    return `<#${c.channel_id}>\n└ Name: \`${c.default_name}\` | Limit: ${limit}`;
  }).join('\n\n');

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setTitle('🧪 Lab Creator Channels')
        .setDescription(creatorList)
        .setColor(0x5865F2)
        .setFooter({ text: `${creators.length} creator(s) configured` }),
    ],
    ephemeral: true,
  });
}
