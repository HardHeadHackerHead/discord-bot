import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Guild,
  Role,
} from 'discord.js';
import { COLORS } from '../../../shared/utils/embed.js';
import { RoleMessage, MessageRole, SelectionMode } from '../services/RoleService.js';

const MESSAGES_PER_PAGE = 5;
const ROLES_PER_PAGE = 10;

export interface RolesPanelState {
  view: 'list' | 'detail' | 'add_roles' | 'edit_roles';
  page: number;
  selectedMessageId: string | null;
  selectedRoleId?: string | null;
}

export class RolesPanel {
  // ==================== List View ====================

  static createListEmbed(
    messages: RoleMessage[],
    rolesChannel: string | null,
    page: number,
    guild: Guild
  ): EmbedBuilder {
    const totalPages = Math.max(1, Math.ceil(messages.length / MESSAGES_PER_PAGE));
    const start = page * MESSAGES_PER_PAGE;
    const pageMessages = messages.slice(start, start + MESSAGES_PER_PAGE);

    const embed = new EmbedBuilder()
      .setTitle('Role Messages')
      .setColor(COLORS.primary);

    // Show roles channel info
    const channelInfo = rolesChannel
      ? `**Roles Channel:** <#${rolesChannel}>`
      : '**Roles Channel:** Not set';

    if (messages.length === 0) {
      embed.setDescription(
        `${channelInfo}\n\n` +
        'No role messages have been created yet.\n\n' +
        'Click **Create Message** to get started!'
      );
    } else {
      const lines = pageMessages.map((msg, i) => {
        const num = start + i + 1;
        const modeIcon = msg.selection_mode === 'single' ? '1️⃣' : '🔢';
        return `**${num}. ${msg.title || 'Untitled'}** ${modeIcon}\n` +
          `└ <#${msg.channel_id}> • ID: \`${msg.message_id}\``;
      });

      embed.setDescription(
        `${channelInfo}\n\n` +
        lines.join('\n\n')
      );

      embed.setFooter({ text: `Page ${page + 1}/${totalPages} • ${messages.length} message(s)` });
    }

    return embed;
  }

  static createListComponents(
    messages: RoleMessage[],
    page: number,
    hasManageRoles: boolean
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
    const totalPages = Math.max(1, Math.ceil(messages.length / MESSAGES_PER_PAGE));
    const start = page * MESSAGES_PER_PAGE;
    const pageMessages = messages.slice(start, start + MESSAGES_PER_PAGE);

    // Message select dropdown (if there are messages)
    if (messages.length > 0 && hasManageRoles) {
      const select = new StringSelectMenuBuilder()
        .setCustomId('roles:select_message')
        .setPlaceholder('Select a message to manage...')
        .addOptions(
          pageMessages.map((msg, i) => {
            const num = start + i + 1;
            return new StringSelectMenuOptionBuilder()
              .setLabel(`${num}. ${msg.title || 'Untitled'}`)
              .setDescription(`ID: ${msg.message_id}`)
              .setValue(msg.message_id);
          })
        );

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
      );
    }

    // Action buttons
    if (hasManageRoles) {
      const buttonRow = new ActionRowBuilder<ButtonBuilder>();

      // Navigation
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId('roles:prev')
          .setEmoji('◀')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page === 0)
      );

      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId('roles:next')
          .setEmoji('▶')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(page >= totalPages - 1)
      );

      // Create new message
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId('roles:create')
          .setLabel('Create Message')
          .setStyle(ButtonStyle.Success)
      );

      // Set channel
      buttonRow.addComponents(
        new ButtonBuilder()
          .setCustomId('roles:set_channel')
          .setLabel('Set Channel')
          .setStyle(ButtonStyle.Primary)
      );

      components.push(buttonRow);
    }

    return components;
  }

  // ==================== Detail View ====================

  static createDetailEmbed(
    message: RoleMessage,
    roles: MessageRole[],
    guild: Guild
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(message.title || 'Untitled')
      .setColor(COLORS.primary);

    let description = message.description || '';
    if (description) description += '\n\n';

    // Selection mode display
    const modeText = message.selection_mode === 'single'
      ? '1️⃣ **Single Select** (users pick one)'
      : '🔢 **Multi Select** (users pick any)';

    description += `**Mode:** ${modeText}\n`;
    description += `**Channel:** <#${message.channel_id}>\n`;
    description += `**Message ID:** \`${message.message_id}\`\n\n`;

    if (roles.length === 0) {
      description += '*No roles configured yet.*\n\nClick **Add Roles** to add roles to this message.';
    } else {
      description += '**Configured Roles:**\n';
      for (const r of roles) {
        const role = guild.roles.cache.get(r.role_id);
        const roleName = role ? `<@&${role.id}>` : `Unknown (${r.role_id})`;
        const desc = r.description ? ` - ${r.description}` : '';
        description += `• ${roleName}${desc}\n`;
      }
    }

    embed.setDescription(description);
    embed.setFooter({ text: `${roles.length} role(s) configured` });

    return embed;
  }

  static createDetailComponents(
    message: RoleMessage,
    roles: MessageRole[]
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    // Role select for removal (if there are roles)
    if (roles.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId('roles:remove_role')
        .setPlaceholder('Select a role to remove...')
        .addOptions(
          roles.map((r) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`Remove role`)
              .setDescription(r.description || r.role_id)
              .setValue(r.role_id)
          )
        );

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
      );
    }

    // Top action buttons row
    const topButtonRow = new ActionRowBuilder<ButtonBuilder>();

    topButtonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:back')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
    );

    // Toggle mode button
    const toggleLabel = message.selection_mode === 'single'
      ? 'Switch to Multi'
      : 'Switch to Single';
    const toggleEmoji = message.selection_mode === 'single' ? '🔢' : '1️⃣';

    topButtonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:toggle_mode')
        .setLabel(toggleLabel)
        .setEmoji(toggleEmoji)
        .setStyle(ButtonStyle.Primary)
    );

    topButtonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:add_roles')
        .setLabel('Add Roles')
        .setStyle(ButtonStyle.Success)
    );

    topButtonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:delete_message')
        .setLabel('Delete Message')
        .setStyle(ButtonStyle.Danger)
    );

    components.push(topButtonRow);

    // Second row for edit and repost buttons
    const secondButtonRow = new ActionRowBuilder<ButtonBuilder>();

    if (roles.length > 0) {
      secondButtonRow.addComponents(
        new ButtonBuilder()
          .setCustomId('roles:edit_roles')
          .setLabel('Edit Roles')
          .setEmoji('✏️')
          .setStyle(ButtonStyle.Primary)
      );
    }

    secondButtonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:repost')
        .setLabel('Repost Message')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary)
    );

    components.push(secondButtonRow);

    return components;
  }

  // ==================== Add Roles View ====================

  static createAddRolesEmbed(message: RoleMessage, currentRoles: MessageRole[]): EmbedBuilder {
    const currentCount = currentRoles.length;

    return new EmbedBuilder()
      .setTitle('Add Roles')
      .setDescription(
        `Adding roles to: **${message.title || 'Untitled'}**\n\n` +
        `Currently configured: **${currentCount}** role(s)\n\n` +
        'Select roles from the dropdown below to add them to this message.\n' +
        'Users will be able to self-assign these roles.'
      )
      .setColor(COLORS.success);
  }

  static createAddRolesComponents(
    guild: Guild,
    currentRoles: MessageRole[],
    page: number = 0
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    const botMember = guild.members.me;
    const currentRoleIds = new Set(currentRoles.map((r) => r.role_id));

    // Get assignable roles that aren't already added
    const assignableRoles = guild.roles.cache
      .filter((role) => {
        // Filter out @everyone, managed roles, and roles higher than bot
        if (role.id === guild.id) return false;
        if (role.managed) return false;
        if (botMember && role.position >= botMember.roles.highest.position) return false;
        // Filter out roles already added
        if (currentRoleIds.has(role.id)) return false;
        return true;
      })
      .sort((a, b) => b.position - a.position);

    const rolesArray = Array.from(assignableRoles.values());
    const totalPages = Math.max(1, Math.ceil(rolesArray.length / ROLES_PER_PAGE));
    const start = page * ROLES_PER_PAGE;
    const pageRoles = rolesArray.slice(start, start + ROLES_PER_PAGE);

    if (pageRoles.length > 0) {
      const roleOptions = pageRoles.map((role) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(role.name)
          .setDescription(`Click to add with description`)
          .setValue(role.id)
      );

      const select = new StringSelectMenuBuilder()
        .setCustomId('roles:select_add_role')
        .setPlaceholder('Select a role to add...')
        .setMinValues(1)
        .setMaxValues(1) // One at a time so we can prompt for description
        .addOptions(roleOptions);

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
      );
    }

    // Navigation and done buttons
    const buttonRow = new ActionRowBuilder<ButtonBuilder>();

    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:add_prev')
        .setEmoji('◀')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0)
    );

    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:add_next')
        .setEmoji('▶')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:done_adding')
        .setLabel('Done')
        .setStyle(ButtonStyle.Primary)
    );

    components.push(buttonRow);

    return components;
  }

  // ==================== Edit Roles View ====================

  static createEditRolesEmbed(
    message: RoleMessage,
    roles: MessageRole[],
    guild: Guild
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle('Edit Roles')
      .setColor(COLORS.primary);

    let description = `Editing roles for: **${message.title || 'Untitled'}**\n\n`;

    if (roles.length === 0) {
      description += '*No roles to edit.*';
    } else {
      description += '**Current Order:**\n';
      roles.forEach((r, index) => {
        const role = guild.roles.cache.get(r.role_id);
        const roleName = role ? `<@&${role.id}>` : `Unknown (${r.role_id})`;
        const desc = r.description ? `\n   └ ${r.description}` : '';
        description += `${index + 1}. ${roleName}${desc}\n`;
      });
      description += '\n*Select a role from the dropdown to edit its description or reorder it.*';
    }

    embed.setDescription(description);
    embed.setFooter({ text: `${roles.length} role(s) • Use arrows to reorder` });

    return embed;
  }

  static createEditRolesComponents(
    roles: MessageRole[],
    guild: Guild,
    selectedRoleId: string | null
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    // Role select dropdown
    if (roles.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId('roles:select_edit_role')
        .setPlaceholder('Select a role to edit...')
        .addOptions(
          roles.map((r, index) => {
            const role = guild.roles.cache.get(r.role_id);
            const roleName = role?.name || `Unknown (${r.role_id})`;
            return new StringSelectMenuOptionBuilder()
              .setLabel(`${index + 1}. ${roleName}`)
              .setDescription(r.description || 'No description')
              .setValue(r.role_id)
              .setDefault(r.role_id === selectedRoleId);
          })
        );

      components.push(
        new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
      );
    }

    // Action buttons for selected role
    if (selectedRoleId) {
      const selectedIndex = roles.findIndex((r) => r.role_id === selectedRoleId);
      const actionRow = new ActionRowBuilder<ButtonBuilder>();

      // Move up button
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId('roles:move_up')
          .setEmoji('⬆️')
          .setLabel('Move Up')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(selectedIndex <= 0)
      );

      // Move down button
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId('roles:move_down')
          .setEmoji('⬇️')
          .setLabel('Move Down')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(selectedIndex >= roles.length - 1)
      );

      // Edit description button
      actionRow.addComponents(
        new ButtonBuilder()
          .setCustomId('roles:edit_description')
          .setEmoji('✏️')
          .setLabel('Edit Description')
          .setStyle(ButtonStyle.Primary)
      );

      components.push(actionRow);
    }

    // Back button row
    const backRow = new ActionRowBuilder<ButtonBuilder>();

    backRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:done_editing')
        .setLabel('Done')
        .setStyle(ButtonStyle.Success)
    );

    components.push(backRow);

    return components;
  }

  static createEditDescriptionModal(roleName: string, roleId: string, currentDescription: string | null): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`roles:modal_edit_desc:${roleId}`)
      .setTitle(`Edit ${roleName}`);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('roles:input_edit_desc')
      .setLabel('Description')
      .setPlaceholder('e.g., Not started yet. Learning and observing.')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100);

    if (currentDescription) {
      descriptionInput.setValue(currentDescription);
    }

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    return modal;
  }

  // ==================== Create Message Flow ====================

  static createModeSelectionEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('Create Role Message')
      .setDescription(
        'Choose how users will select roles from this message:\n\n' +
        '1️⃣ **Single Select**\n' +
        'Users can only have ONE role from this list at a time.\n' +
        '*Best for: Color roles, pronouns, team selection*\n\n' +
        '🔢 **Multi Select**\n' +
        'Users can toggle any number of roles on/off.\n' +
        '*Best for: Notifications, interests, game roles*'
      )
      .setColor(COLORS.primary);
  }

  static createModeSelectionComponents(): ActionRowBuilder<ButtonBuilder>[] {
    const buttonRow = new ActionRowBuilder<ButtonBuilder>();

    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:create_single')
        .setLabel('Single Select')
        .setEmoji('1️⃣')
        .setStyle(ButtonStyle.Primary)
    );

    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:create_multi')
        .setLabel('Multi Select')
        .setEmoji('🔢')
        .setStyle(ButtonStyle.Primary)
    );

    buttonRow.addComponents(
      new ButtonBuilder()
        .setCustomId('roles:cancel_create')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    return [buttonRow];
  }

  // ==================== Modals ====================

  static createMessageModal(mode: SelectionMode): ModalBuilder {
    const modeLabel = mode === 'single' ? 'Single Select' : 'Multi Select';
    const modal = new ModalBuilder()
      .setCustomId(`roles:modal_create:${mode}`)
      .setTitle(`Create ${modeLabel} Role Message`);

    const titleInput = new TextInputBuilder()
      .setCustomId('roles:input_title')
      .setLabel('Title')
      .setPlaceholder('e.g., Color Roles, Notification Roles')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(255);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('roles:input_description')
      .setLabel('Description (optional)')
      .setPlaceholder('e.g., Pick your favorite color!')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(2000);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    return modal;
  }

  static createRoleDescriptionModal(roleName: string, roleId: string): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`roles:modal_role_desc:${roleId}`)
      .setTitle(`Add ${roleName}`);

    const descriptionInput = new TextInputBuilder()
      .setCustomId('roles:input_role_desc')
      .setLabel('Description')
      .setPlaceholder('e.g., Not started yet. Learning and observing.')
      .setStyle(TextInputStyle.Short)
      .setRequired(false)
      .setMaxLength(100); // Discord dropdown description limit

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput)
    );

    return modal;
  }

  static createChannelModal(currentChannelId: string | null): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId('roles:modal_channel')
      .setTitle('Set Roles Channel');

    const channelInput = new TextInputBuilder()
      .setCustomId('roles:input_channel')
      .setLabel('Channel ID')
      .setPlaceholder('Right-click channel > Copy Channel ID')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(17)
      .setMaxLength(20);

    if (currentChannelId) {
      channelInput.setValue(currentChannelId);
    }

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(channelInput)
    );

    return modal;
  }

  // ==================== Result Embeds ====================

  static createSuccessEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(COLORS.success);
  }

  static createErrorEmbed(title: string, description: string): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(COLORS.error);
  }
}
