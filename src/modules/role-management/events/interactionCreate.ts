import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  GuildMember,
  PermissionFlagsBits,
  TextChannel,
  ChannelType,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { RoleService, SelectionMode } from '../services/RoleService.js';
import { RolesPanel, RolesPanelState } from '../components/RolesPanel.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('RoleManagement:Interaction');

let roleService: RoleService | null = null;

// Track panel states per message
const panelStates = new Map<string, RolesPanelState>();

// Track add roles page per user
const addRolesPage = new Map<string, number>();

export function setRoleService(service: RoleService): void {
  roleService = service;
}

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;
    if (!roleService) return;

    // Handle admin panel buttons (roles:)
    if (interaction.isButton() && interaction.customId.startsWith('roles:')) {
      await handleAdminButton(interaction, roleService);
      return;
    }

    // Handle admin panel select menus (roles:)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('roles:')) {
      await handleAdminSelectMenu(interaction, roleService);
      return;
    }

    // Handle admin panel modals (roles:)
    if (interaction.isModalSubmit() && interaction.customId.startsWith('roles:')) {
      await handleAdminModal(interaction, roleService);
      return;
    }

    // Handle user-facing self-role dropdown (selfrole:)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('selfrole:')) {
      await handleSelfRoleSelect(interaction, roleService);
      return;
    }
  },
};

function getState(messageId: string): RolesPanelState {
  let state = panelStates.get(messageId);
  if (!state) {
    state = { view: 'list', page: 0, selectedMessageId: null };
    panelStates.set(messageId, state);
  }
  return state;
}

function hasManageRoles(member: GuildMember | null): boolean {
  return member?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;
}

// ==================== User-Facing Self-Role Handler ====================

async function handleSelfRoleSelect(
  interaction: StringSelectMenuInteraction,
  service: RoleService
): Promise<void> {
  const guild = interaction.guild;
  if (!guild) return;

  // Extract message ID from customId: selfrole:select:<messageId>
  const parts = interaction.customId.split(':');
  const discordMessageId = parts[2];

  if (!discordMessageId) return;

  const roleId = interaction.values[0];
  if (!roleId) return;

  const member = interaction.member as GuildMember;

  // Verify this role is configured for this message
  const record = await service.getRoleMessage(discordMessageId);
  if (!record) {
    await interaction.reply({
      content: 'This role message no longer exists.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const msgRole = await service.getRoleFromMessage(record.id, roleId);
  if (!msgRole) {
    await interaction.reply({
      content: 'This role is no longer available.',
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
    return;
  }

  const role = guild.roles.cache.get(roleId);
  const roleName = role?.name || 'Unknown Role';

  // Handle based on selection mode
  if (record.selection_mode === 'single') {
    // Single select mode: Remove any other roles from this message, then add the new one
    const allMessageRoles = await service.getMessageRoles(record.id);
    const removedRoles: string[] = [];

    // Check if user already has the selected role
    const alreadyHasRole = member.roles.cache.has(roleId);

    if (alreadyHasRole) {
      // In single-select mode, clicking the same role removes it
      await member.roles.remove(roleId).catch(() => {});

      await service.updateRoleMessageEmbed(guild, record);

      await interaction.reply({
        content: `❌ The **${roleName}** role has been removed.`,
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
      return;
    }

    // Remove any other roles from this message that the user has
    for (const msgRoleItem of allMessageRoles) {
      if (msgRoleItem.role_id !== roleId && member.roles.cache.has(msgRoleItem.role_id)) {
        const oldRole = guild.roles.cache.get(msgRoleItem.role_id);
        if (oldRole) {
          await member.roles.remove(oldRole).catch(() => {});
          removedRoles.push(oldRole.name);
        }
      }
    }

    // Add the new role
    const addResult = await service.toggleRole(member, roleId);

    if (addResult === null) {
      await interaction.reply({
        content: 'Failed to assign role. The bot may not have permission to manage this role.',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    await service.updateRoleMessageEmbed(guild, record);

    // Build response message
    let message: string;
    if (removedRoles.length > 0) {
      message = `🔄 Switched from **${removedRoles[0]}** to **${roleName}**!`;
    } else {
      message = `✅ You now have the **${roleName}** role!`;
    }

    await interaction.reply({
      content: message,
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);

  } else {
    // Multi-select mode: Toggle the role (existing behavior)
    const result = await service.toggleRole(member, roleId);

    if (result === null) {
      await interaction.reply({
        content: 'Failed to toggle role. The bot may not have permission to manage this role.',
        ephemeral: true,
      });
      setTimeout(() => interaction.deleteReply().catch(() => {}), 5000);
      return;
    }

    await service.updateRoleMessageEmbed(guild, record);

    const message = result.added
      ? `✅ You now have the **${roleName}** role!`
      : `❌ The **${roleName}** role has been removed.`;

    await interaction.reply({
      content: message,
      ephemeral: true,
    });
    setTimeout(() => interaction.deleteReply().catch(() => {}), 3000);
  }
}

// ==================== Admin Panel Button Handler ====================

async function handleAdminButton(
  interaction: ButtonInteraction,
  service: RoleService
): Promise<void> {
  const [, action] = interaction.customId.split(':');
  const state = getState(interaction.message.id);
  const guild = interaction.guild!;
  const member = interaction.member as GuildMember | null;

  if (!hasManageRoles(member)) {
    await interaction.reply({
      embeds: [RolesPanel.createErrorEmbed('Permission Denied', 'You need the Manage Roles permission.')],
      ephemeral: true,
    });
    return;
  }

  switch (action) {
    case 'prev':
      state.page = Math.max(0, state.page - 1);
      await updateListView(interaction, service, state);
      break;

    case 'next':
      state.page++;
      await updateListView(interaction, service, state);
      break;

    case 'create':
      // Show mode selection instead of modal directly
      await interaction.update({
        embeds: [RolesPanel.createModeSelectionEmbed()],
        components: RolesPanel.createModeSelectionComponents(),
      });
      break;

    case 'create_single':
      // User chose single-select mode, show modal
      await interaction.showModal(RolesPanel.createMessageModal('single'));
      break;

    case 'create_multi':
      // User chose multi-select mode, show modal
      await interaction.showModal(RolesPanel.createMessageModal('multi'));
      break;

    case 'cancel_create':
      // Cancel and go back to list
      await updateListView(interaction, service, state);
      break;

    case 'set_channel':
      const currentChannel = await service.getRolesChannel(guild.id);
      await interaction.showModal(RolesPanel.createChannelModal(currentChannel));
      break;

    case 'back':
      state.view = 'list';
      state.selectedMessageId = null;
      await updateListView(interaction, service, state);
      break;

    case 'toggle_mode':
      if (!state.selectedMessageId) return;

      const record = await service.getRoleMessage(state.selectedMessageId);
      if (!record) return;

      // Toggle the mode
      const newMode: SelectionMode = record.selection_mode === 'single' ? 'multi' : 'single';
      await service.setSelectionMode(record.id, newMode);

      // Update the Discord message embed
      const updatedRecord = await service.getRoleMessage(state.selectedMessageId);
      if (updatedRecord) {
        await service.updateRoleMessageEmbed(guild, updatedRecord);
      }

      // Refresh the detail view
      await updateDetailView(interaction, service, state);
      break;

    case 'add_roles':
      if (!state.selectedMessageId) return;
      state.view = 'add_roles';
      addRolesPage.set(interaction.user.id, 0);
      await updateAddRolesView(interaction, service, state, 0);
      break;

    case 'add_prev': {
      const currentPage = addRolesPage.get(interaction.user.id) || 0;
      const newPage = Math.max(0, currentPage - 1);
      addRolesPage.set(interaction.user.id, newPage);
      await updateAddRolesView(interaction, service, state, newPage);
      break;
    }

    case 'add_next': {
      const currentPage = addRolesPage.get(interaction.user.id) || 0;
      addRolesPage.set(interaction.user.id, currentPage + 1);
      await updateAddRolesView(interaction, service, state, currentPage + 1);
      break;
    }

    case 'done_adding':
      state.view = 'detail';
      await updateDetailView(interaction, service, state);
      break;

    case 'delete_message':
      if (!state.selectedMessageId) return;

      const success = await service.deleteRoleMessage(state.selectedMessageId, guild);

      if (success) {
        state.view = 'list';
        state.selectedMessageId = null;
        await updateListView(interaction, service, state);
      } else {
        await interaction.reply({
          embeds: [RolesPanel.createErrorEmbed('Delete Failed', 'Failed to delete the message.')],
          ephemeral: true,
        });
      }
      break;

    case 'repost':
      if (!state.selectedMessageId) return;

      await interaction.deferUpdate();

      const repostResult = await service.repostRoleMessage(state.selectedMessageId, guild);

      if (repostResult) {
        // Update the selected message ID to the new one
        state.selectedMessageId = repostResult.newMessageId;

        // Refresh the detail view with success message
        const newRecord = await service.getRoleMessage(repostResult.newMessageId);
        if (newRecord) {
          const roles = await service.getMessageRoles(newRecord.id);
          await interaction.editReply({
            embeds: [RolesPanel.createSuccessEmbed(
              'Message Reposted',
              `**${newRecord.title || 'Untitled'}** has been reposted in <#${newRecord.channel_id}>.\n\nThe old message was deleted and a new one was created with all the same roles and settings.`
            )],
            components: RolesPanel.createDetailComponents(newRecord, roles),
          });
        }
      } else {
        await interaction.editReply({
          embeds: [RolesPanel.createErrorEmbed('Repost Failed', 'Failed to repost the message. Check bot permissions.')],
          components: [],
        });
      }
      break;

    case 'edit_roles':
      if (!state.selectedMessageId) return;
      state.view = 'edit_roles';
      state.selectedRoleId = null;
      await updateEditRolesView(interaction, service, state);
      break;

    case 'done_editing':
      state.view = 'detail';
      state.selectedRoleId = null;
      await updateDetailView(interaction, service, state);
      break;

    case 'move_up':
      if (!state.selectedMessageId || !state.selectedRoleId) return;
      {
        const msgRecord = await service.getRoleMessage(state.selectedMessageId);
        if (!msgRecord) return;

        await service.moveRoleUp(msgRecord.id, state.selectedRoleId);
        await service.updateRoleMessageEmbed(guild, msgRecord);
        await updateEditRolesView(interaction, service, state);
      }
      break;

    case 'move_down':
      if (!state.selectedMessageId || !state.selectedRoleId) return;
      {
        const msgRecord = await service.getRoleMessage(state.selectedMessageId);
        if (!msgRecord) return;

        await service.moveRoleDown(msgRecord.id, state.selectedRoleId);
        await service.updateRoleMessageEmbed(guild, msgRecord);
        await updateEditRolesView(interaction, service, state);
      }
      break;

    case 'edit_description':
      if (!state.selectedMessageId || !state.selectedRoleId) return;
      {
        const msgRecord = await service.getRoleMessage(state.selectedMessageId);
        if (!msgRecord) return;

        const roleData = await service.getRoleFromMessage(msgRecord.id, state.selectedRoleId);
        const discordRole = guild.roles.cache.get(state.selectedRoleId);
        const roleName = discordRole?.name || 'Unknown Role';

        await interaction.showModal(
          RolesPanel.createEditDescriptionModal(roleName, state.selectedRoleId, roleData?.description || null)
        );
      }
      break;
  }
}

// ==================== Admin Panel Select Menu Handler ====================

async function handleAdminSelectMenu(
  interaction: StringSelectMenuInteraction,
  service: RoleService
): Promise<void> {
  const [, action] = interaction.customId.split(':');
  const state = getState(interaction.message.id);
  const guild = interaction.guild!;
  const member = interaction.member as GuildMember | null;

  if (!hasManageRoles(member)) {
    await interaction.reply({
      embeds: [RolesPanel.createErrorEmbed('Permission Denied', 'You need the Manage Roles permission.')],
      ephemeral: true,
    });
    return;
  }

  switch (action) {
    case 'select_message':
      const selectedMessageId = interaction.values[0];
      if (!selectedMessageId) return;

      state.view = 'detail';
      state.selectedMessageId = selectedMessageId;
      await updateDetailView(interaction, service, state);
      break;

    case 'remove_role':
      if (!state.selectedMessageId) return;

      const roleIdToRemove = interaction.values[0];
      if (!roleIdToRemove) return;

      const record = await service.getRoleMessage(state.selectedMessageId);
      if (!record) return;

      const removed = await service.removeRoleFromMessage(record.id, roleIdToRemove);

      if (removed) {
        // Update the Discord message
        await service.updateRoleMessageEmbed(guild, record);
      }

      await updateDetailView(interaction, service, state);
      break;

    case 'select_add_role':
      if (!state.selectedMessageId) return;

      const roleIdToAdd = interaction.values[0];
      if (!roleIdToAdd) return;

      const roleToAdd = guild.roles.cache.get(roleIdToAdd);
      if (!roleToAdd) return;

      // Show modal to enter description
      await interaction.showModal(RolesPanel.createRoleDescriptionModal(roleToAdd.name, roleIdToAdd));
      break;

    case 'select_edit_role':
      if (!state.selectedMessageId) return;

      const selectedRoleId = interaction.values[0];
      if (!selectedRoleId) return;

      state.selectedRoleId = selectedRoleId;
      await updateEditRolesView(interaction, service, state);
      break;
  }
}

// ==================== Admin Panel Modal Handler ====================

async function handleAdminModal(
  interaction: ModalSubmitInteraction,
  service: RoleService
): Promise<void> {
  const customIdParts = interaction.customId.split(':');
  const action = customIdParts[1];
  const guild = interaction.guild!;

  // Handle modal_create with mode: roles:modal_create:single or roles:modal_create:multi
  if (action === 'modal_create') {
    const selectionMode = (customIdParts[2] as SelectionMode) || 'multi';
    const title = interaction.fields.getTextInputValue('roles:input_title');
    const description = interaction.fields.getTextInputValue('roles:input_description') || '';

    // Get or use current channel
    let channelId: string | null = await service.getRolesChannel(guild.id);
    if (!channelId) {
      if (interaction.channel?.type === ChannelType.GuildText) {
        channelId = interaction.channelId;
      } else {
        await interaction.reply({
          embeds: [RolesPanel.createErrorEmbed('No Channel', 'Please set a roles channel first.')],
          ephemeral: true,
        });
        return;
      }
    }

    const channel = guild.channels.cache.get(channelId!) as TextChannel;
    if (!channel) {
      await interaction.reply({
        embeds: [RolesPanel.createErrorEmbed('Channel Not Found', 'The roles channel no longer exists.')],
        ephemeral: true,
      });
      return;
    }

    await interaction.deferUpdate();

    const result = await service.createRoleMessage(
      guild,
      channel,
      title,
      description,
      selectionMode,
      interaction.user.id
    );

    if (result) {
      // Update the panel to show the new message was created
      const messages = await service.getRoleMessagesByGuild(guild.id);
      const rolesChannel = await service.getRolesChannel(guild.id);

      // Reset state if we have a message reference
      if (interaction.message) {
        const state = getState(interaction.message.id);
        state.page = 0;
      }

      const modeLabel = selectionMode === 'single' ? 'Single Select' : 'Multi Select';
      await interaction.editReply({
        embeds: [RolesPanel.createSuccessEmbed(
          'Message Created',
          `**${title}** (${modeLabel}) has been created in <#${channel.id}>.\n\nSelect it from the list below to add roles.`
        )],
        components: RolesPanel.createListComponents(messages, 0, true),
      });
    } else {
      await interaction.editReply({
        embeds: [RolesPanel.createErrorEmbed('Creation Failed', 'Failed to create the role message. Check bot permissions.')],
        components: [],
      });
    }
    return;
  }

  // Handle role description modal: roles:modal_role_desc:<roleId>
  if (action === 'modal_role_desc') {
    const roleId = customIdParts[2];
    if (!roleId) return;

    const description = interaction.fields.getTextInputValue('roles:input_role_desc').trim() || undefined;

    // Get the state to find the selected message
    if (!interaction.message) return;
    const state = getState(interaction.message.id);
    if (!state.selectedMessageId) return;

    const msgRecord = await service.getRoleMessage(state.selectedMessageId);
    if (!msgRecord) return;

    // Add the role with description
    await service.addRoleToMessage(msgRecord.id, roleId, description);

    // Update the Discord message
    await service.updateRoleMessageEmbed(guild, msgRecord);

    await interaction.deferUpdate();

    // Refresh the add roles view
    const page = addRolesPage.get(interaction.user.id) || 0;
    const currentRoles = await service.getMessageRoles(msgRecord.id);

    await interaction.editReply({
      embeds: [RolesPanel.createAddRolesEmbed(msgRecord, currentRoles)],
      components: RolesPanel.createAddRolesComponents(guild, currentRoles, page),
    });
    return;
  }

  // Handle edit description modal: roles:modal_edit_desc:<roleId>
  if (action === 'modal_edit_desc') {
    const roleId = customIdParts[2];
    if (!roleId) return;

    const description = interaction.fields.getTextInputValue('roles:input_edit_desc').trim() || null;

    // Get the state to find the selected message
    if (!interaction.message) return;
    const state = getState(interaction.message.id);
    if (!state.selectedMessageId) return;

    const msgRecord = await service.getRoleMessage(state.selectedMessageId);
    if (!msgRecord) return;

    // Update the role description
    await service.updateRoleDescription(msgRecord.id, roleId, description);

    // Update the Discord message
    await service.updateRoleMessageEmbed(guild, msgRecord);

    await interaction.deferUpdate();

    // Refresh the edit roles view
    const currentRoles = await service.getMessageRoles(msgRecord.id);

    await interaction.editReply({
      embeds: [RolesPanel.createEditRolesEmbed(msgRecord, currentRoles, guild)],
      components: RolesPanel.createEditRolesComponents(currentRoles, guild, state.selectedRoleId || null),
    });
    return;
  }

  switch (action) {
    case 'modal_channel':
      const inputChannelId = interaction.fields.getTextInputValue('roles:input_channel').trim();

      // Validate channel exists and is a text channel
      const targetChannel = guild.channels.cache.get(inputChannelId);
      if (!targetChannel || targetChannel.type !== ChannelType.GuildText) {
        await interaction.reply({
          embeds: [RolesPanel.createErrorEmbed('Invalid Channel', 'Please enter a valid text channel ID.')],
          ephemeral: true,
        });
        return;
      }

      await service.setRolesChannel(guild.id, inputChannelId);

      await interaction.deferUpdate();

      // Update the panel with success message
      const messages = await service.getRoleMessagesByGuild(guild.id);

      // Reset state if we have a message reference
      if (interaction.message) {
        const state = getState(interaction.message.id);
        state.page = 0;
      }

      await interaction.editReply({
        embeds: [RolesPanel.createSuccessEmbed(
          'Channel Set',
          `Roles channel has been set to <#${inputChannelId}>.\n\nNew role messages will be posted there.`
        )],
        components: RolesPanel.createListComponents(messages, 0, true),
      });
      break;
  }
}

// ==================== View Update Helpers ====================

async function updateListView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  service: RoleService,
  state: RolesPanelState
): Promise<void> {
  const guild = interaction.guild!;
  const messages = await service.getRoleMessagesByGuild(guild.id);
  const rolesChannel = await service.getRolesChannel(guild.id);

  await interaction.update({
    embeds: [RolesPanel.createListEmbed(messages, rolesChannel, state.page, guild)],
    components: RolesPanel.createListComponents(messages, state.page, true),
  });
}

async function updateDetailView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  service: RoleService,
  state: RolesPanelState
): Promise<void> {
  const guild = interaction.guild!;

  if (!state.selectedMessageId) {
    await updateListView(interaction, service, state);
    return;
  }

  const record = await service.getRoleMessage(state.selectedMessageId);
  if (!record) {
    state.view = 'list';
    state.selectedMessageId = null;
    await updateListView(interaction, service, state);
    return;
  }

  const roles = await service.getMessageRoles(record.id);

  await interaction.update({
    embeds: [RolesPanel.createDetailEmbed(record, roles, guild)],
    components: RolesPanel.createDetailComponents(record, roles),
  });
}

async function updateAddRolesView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  service: RoleService,
  state: RolesPanelState,
  page: number
): Promise<void> {
  const guild = interaction.guild!;

  if (!state.selectedMessageId) {
    await updateListView(interaction, service, state);
    return;
  }

  const record = await service.getRoleMessage(state.selectedMessageId);
  if (!record) {
    state.view = 'list';
    state.selectedMessageId = null;
    await updateListView(interaction, service, state);
    return;
  }

  const currentRoles = await service.getMessageRoles(record.id);

  await interaction.update({
    embeds: [RolesPanel.createAddRolesEmbed(record, currentRoles)],
    components: RolesPanel.createAddRolesComponents(guild, currentRoles, page),
  });
}

async function updateEditRolesView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  service: RoleService,
  state: RolesPanelState
): Promise<void> {
  const guild = interaction.guild!;

  if (!state.selectedMessageId) {
    await updateListView(interaction, service, state);
    return;
  }

  const record = await service.getRoleMessage(state.selectedMessageId);
  if (!record) {
    state.view = 'list';
    state.selectedMessageId = null;
    await updateListView(interaction, service, state);
    return;
  }

  const roles = await service.getMessageRoles(record.id);

  await interaction.update({
    embeds: [RolesPanel.createEditRolesEmbed(record, roles, guild)],
    components: RolesPanel.createEditRolesComponents(roles, guild, state.selectedRoleId || null),
  });
}
