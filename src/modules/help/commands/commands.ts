import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  ApplicationCommandOptionType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  ComponentType,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';

/**
 * Parse permissions from a bigint into readable strings
 */
function parsePermissions(permissions: bigint | null | undefined): { text: string; icon: string } {
  if (!permissions) {
    return { text: 'Everyone', icon: '🌐' };
  }

  // Check for Administrator first (most restrictive shown)
  if ((permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) {
    return { text: 'Administrator', icon: '👑' };
  }

  const permissionMap: { flag: bigint; name: string; icon: string }[] = [
    { flag: PermissionFlagsBits.ManageGuild, name: 'Manage Server', icon: '⚙️' },
    { flag: PermissionFlagsBits.ManageChannels, name: 'Manage Channels', icon: '📁' },
    { flag: PermissionFlagsBits.ManageRoles, name: 'Manage Roles', icon: '🎭' },
    { flag: PermissionFlagsBits.ManageMessages, name: 'Manage Messages', icon: '💬' },
    { flag: PermissionFlagsBits.KickMembers, name: 'Kick Members', icon: '👢' },
    { flag: PermissionFlagsBits.BanMembers, name: 'Ban Members', icon: '🔨' },
    { flag: PermissionFlagsBits.ModerateMembers, name: 'Moderate Members', icon: '🛡️' },
    { flag: PermissionFlagsBits.MoveMembers, name: 'Move Members', icon: '🔀' },
  ];

  const found: string[] = [];
  for (const perm of permissionMap) {
    if ((permissions & perm.flag) === perm.flag) {
      found.push(perm.name);
    }
  }

  if (found.length === 0) {
    return { text: 'Everyone', icon: '🌐' };
  }

  return { text: found.join(', '), icon: '🔒' };
}

/**
 * Get subcommands for a command
 */
function getSubcommands(options: readonly { name: string; description: string; type: number }[]): { name: string; description: string }[] {
  if (!options || options.length === 0) return [];

  return options
    .filter(
      opt => opt.type === ApplicationCommandOptionType.Subcommand ||
             opt.type === ApplicationCommandOptionType.SubcommandGroup
    )
    .map(sub => ({ name: sub.name, description: sub.description }));
}

interface CommandInfo {
  name: string;
  description: string;
  permissions: { text: string; icon: string };
  subcommands: { name: string; description: string }[];
}

/**
 * Create the main overview embed
 */
function createOverviewEmbed(commands: CommandInfo[], botName: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📚 ${botName} Commands`)
    .setColor(0x5865F2)
    .setDescription(
      'Use the dropdown menu below to view details about each command.\n\n' +
      '**Quick Reference:**'
    );

  // Group commands by permission level for quick reference
  const adminCommands = commands.filter(c => c.permissions.icon === '👑');
  const modCommands = commands.filter(c => c.permissions.icon === '🔒');
  const publicCommands = commands.filter(c => c.permissions.icon === '🌐');

  let quickRef = '';

  if (publicCommands.length > 0) {
    quickRef += `\n🌐 **Public Commands**\n${publicCommands.map(c => `\`/${c.name}\``).join(' ')}\n`;
  }

  if (modCommands.length > 0) {
    quickRef += `\n🔒 **Moderator Commands**\n${modCommands.map(c => `\`/${c.name}\``).join(' ')}\n`;
  }

  if (adminCommands.length > 0) {
    quickRef += `\n👑 **Admin Commands**\n${adminCommands.map(c => `\`/${c.name}\``).join(' ')}\n`;
  }

  embed.setDescription(
    'Use the dropdown menu below to view details about each command.\n' +
    quickRef
  );

  embed.setFooter({
    text: `${commands.length} commands available • Select a command for details`,
  });

  return embed;
}

/**
 * Create a detailed embed for a specific command
 */
function createCommandDetailEmbed(cmd: CommandInfo, botName: string): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`/${cmd.name}`)
    .setColor(0x5865F2)
    .setDescription(cmd.description || 'No description available');

  // Add subcommands if present
  if (cmd.subcommands.length > 0) {
    const subcommandList = cmd.subcommands
      .map(sub => `\`${sub.name}\` — ${sub.description}`)
      .join('\n');

    embed.addFields({
      name: '📋 Subcommands',
      value: subcommandList,
      inline: false,
    });

    // Add usage examples
    const usageExamples = cmd.subcommands
      .slice(0, 3)
      .map(sub => `\`/${cmd.name} ${sub.name}\``)
      .join('\n');

    embed.addFields({
      name: '💡 Usage',
      value: usageExamples,
      inline: true,
    });
  } else {
    embed.addFields({
      name: '💡 Usage',
      value: `\`/${cmd.name}\``,
      inline: true,
    });
  }

  // Add permissions
  embed.addFields({
    name: `${cmd.permissions.icon} Required Permission`,
    value: cmd.permissions.text,
    inline: true,
  });

  embed.setFooter({
    text: `${botName} • Use the dropdown to view other commands`,
  });

  return embed;
}

/**
 * Create the command select menu
 */
function createCommandSelectMenu(commands: CommandInfo[], selectedCommand?: string): ActionRowBuilder<StringSelectMenuBuilder> {
  const options = commands.slice(0, 25).map(cmd => ({
    label: `/${cmd.name}`,
    description: cmd.description.length > 100 ? cmd.description.substring(0, 97) + '...' : cmd.description,
    value: cmd.name,
    emoji: cmd.permissions.icon,
    default: cmd.name === selectedCommand,
  }));

  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId('help:command_select')
    .setPlaceholder('Select a command to view details...')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu);
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('commands')
    .setDescription('View all available commands and their details'),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.client.application) {
      await interaction.reply({
        content: 'Unable to fetch commands.',
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      // Fetch all commands
      let fetchedCommands;
      if (interaction.guild) {
        fetchedCommands = await interaction.guild.commands.fetch();
      } else {
        fetchedCommands = await interaction.client.application.commands.fetch();
      }

      if (fetchedCommands.size === 0) {
        await interaction.editReply({
          content: 'No commands found.',
        });
        return;
      }

      // Process commands into our format
      const commands: CommandInfo[] = Array.from(fetchedCommands.values())
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(cmd => ({
          name: cmd.name,
          description: cmd.description || 'No description',
          permissions: parsePermissions(cmd.defaultMemberPermissions as bigint | null),
          subcommands: getSubcommands(cmd.options as { name: string; description: string; type: number }[]),
        }));

      const botName = interaction.client.user?.username || 'Bot';

      // Create initial overview embed
      const overviewEmbed = createOverviewEmbed(commands, botName);
      const selectMenu = createCommandSelectMenu(commands);

      const response = await interaction.editReply({
        embeds: [overviewEmbed],
        components: [selectMenu],
      });

      // Create collector for select menu interactions
      const collector = response.createMessageComponentCollector({
        componentType: ComponentType.StringSelect,
        time: 300_000, // 5 minutes
      });

      collector.on('collect', async (selectInteraction: StringSelectMenuInteraction) => {
        if (selectInteraction.customId !== 'help:command_select') return;

        const selectedCommand = selectInteraction.values[0];
        const cmd = commands.find(c => c.name === selectedCommand);

        if (!cmd) {
          await selectInteraction.update({});
          return;
        }

        const detailEmbed = createCommandDetailEmbed(cmd, botName);
        const updatedSelectMenu = createCommandSelectMenu(commands, selectedCommand);

        await selectInteraction.update({
          embeds: [detailEmbed],
          components: [updatedSelectMenu],
        });
      });

      collector.on('end', async () => {
        // Disable the select menu when collector expires
        try {
          const disabledSelectMenu = new StringSelectMenuBuilder()
            .setCustomId('help:command_select')
            .setPlaceholder('Session expired - run /commands again')
            .setDisabled(true)
            .addOptions([{ label: 'Expired', value: 'expired' }]);

          const disabledRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(disabledSelectMenu);

          await interaction.editReply({
            components: [disabledRow],
          });
        } catch {
          // Message may have been deleted
        }
      });
    } catch (error) {
      console.error('Error fetching commands:', error);
      await interaction.editReply({
        content: 'An error occurred while fetching commands.',
      });
    }
  },
};
