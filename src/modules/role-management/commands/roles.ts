import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  GuildMember,
} from 'discord.js';
import { SlashCommand } from '../../../types/command.types.js';
import { RoleService } from '../services/RoleService.js';
import { RolesPanel } from '../components/RolesPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('RoleManagement:Command');

let roleService: RoleService | null = null;

export function setRoleService(service: RoleService): void {
  roleService = service;
}

export function getRoleService(): RoleService | null {
  return roleService;
}

export const command: SlashCommand = {
  type: 'slash',
  data: new SlashCommandBuilder()
    .setName('roles')
    .setDescription('View and manage self-assignable roles') as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!roleService) {
      await interaction.reply({
        embeds: [RolesPanel.createErrorEmbed('Service Error', 'Role service is not initialized.')],
        ephemeral: true,
      });
      return;
    }

    const guild = interaction.guild!;
    const member = interaction.member as GuildMember | null;
    const hasManageRoles = member?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;

    // Get current data
    const messages = await roleService.getRoleMessagesByGuild(guild.id);
    const rolesChannel = await roleService.getRolesChannel(guild.id);

    // Create initial view
    const embed = RolesPanel.createListEmbed(messages, rolesChannel, 0, guild);
    const components = RolesPanel.createListComponents(messages, 0, hasManageRoles);

    await interaction.reply({
      embeds: [embed],
      components,
      ephemeral: true,
    });
  },
};
