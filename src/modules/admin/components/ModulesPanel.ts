import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import { BotModule, ModuleMetadata } from '../../../types/module.types.js';
import { COLORS } from '../../../shared/utils/embed.js';

const MODULES_PER_PAGE = 5;

export interface ModuleStatus {
  metadata: ModuleMetadata;
  module?: BotModule;  // Only present if module is loaded
  enabled: boolean;
  loaded: boolean;
}

export interface PanelState {
  page: number;
  selectedModuleId: string | null;
  showAll: boolean;
}

/**
 * Component for the interactive modules panel
 */
export class ModulesPanel {
  /**
   * Check if user is an admin
   */
  static isAdmin(member: GuildMember | null): boolean {
    return member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
  }

  /**
   * Get total pages for module list
   */
  static getTotalPages(moduleCount: number): number {
    return Math.max(1, Math.ceil(moduleCount / MODULES_PER_PAGE));
  }

  /**
   * Get modules for a specific page
   */
  static getModulesForPage(modules: ModuleStatus[], page: number): ModuleStatus[] {
    const start = page * MODULES_PER_PAGE;
    return modules.slice(start, start + MODULES_PER_PAGE);
  }

  /**
   * Create the main module list embed
   */
  static createListEmbed(
    modules: ModuleStatus[],
    page: number,
    isAdmin: boolean
  ): EmbedBuilder {
    const totalPages = this.getTotalPages(modules.length);
    const pageModules = this.getModulesForPage(modules, page);

    const embed = new EmbedBuilder()
      .setTitle('Bot Modules')
      .setColor(COLORS.primary);

    if (modules.length === 0) {
      embed.setDescription('No modules available.');
      return embed;
    }

    // Build module list
    const lines = pageModules.map((status) => {
      const { metadata, enabled, loaded } = status;
      const statusIcon = enabled ? '\u2705' : '\u274C'; // Green check or red X
      const coreTag = metadata.isCore ? ' `[CORE]`' : '';
      const loadedTag = !loaded ? ' `[NOT LOADED]`' : '';
      return `${statusIcon} **${metadata.name}**${coreTag}${loadedTag}\n\u2514 ${metadata.description || 'No description'}`;
    });

    embed.setDescription(lines.join('\n\n'));

    // Footer with page info
    const footerParts = [`Page ${page + 1}/${totalPages}`, `${modules.length} module(s)`];
    if (isAdmin) {
      footerParts.push('Select a module to manage');
    }
    embed.setFooter({ text: footerParts.join(' | ') });

    return embed;
  }

  /**
   * Create the module detail embed
   */
  static createDetailEmbed(
    status: ModuleStatus,
    isAdmin: boolean
  ): EmbedBuilder {
    const { metadata, module, enabled, loaded } = status;

    const embed = new EmbedBuilder()
      .setTitle(metadata.name)
      .setDescription(metadata.description || 'No description available.')
      .setColor(enabled ? COLORS.success : COLORS.neutral);

    // Add fields
    const fields = [
      { name: 'Status', value: enabled ? '\u2705 Enabled' : '\u274C Disabled', inline: true },
      { name: 'Version', value: `v${metadata.version}`, inline: true },
      { name: 'Loaded', value: loaded ? 'Yes' : 'No', inline: true },
    ];

    if (metadata.isCore) {
      fields.push({ name: 'Type', value: '`CORE`', inline: true });
    }

    // Show commands only if module is loaded
    if (module && module.commands.length > 0) {
      fields.push({
        name: `Commands (${module.commands.length})`,
        value: module.commands.map((c) => `\`/${c.data.name}\``).join(', '),
        inline: false,
      });
    }

    if (metadata.dependencies.length > 0) {
      fields.push({
        name: 'Dependencies',
        value: metadata.dependencies.map((d) => `\`${d}\``).join(', '),
        inline: false,
      });
    }

    embed.addFields(fields);

    if (metadata.author) {
      embed.setFooter({ text: `Author: ${metadata.author}` });
    }

    return embed;
  }

  /**
   * Create success/error embed for actions
   */
  static createActionEmbed(
    success: boolean,
    title: string,
    description: string
  ): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(success ? COLORS.success : COLORS.error);
  }

  /**
   * Create the module select dropdown (for admins)
   */
  static createModuleSelect(
    modules: ModuleStatus[],
    page: number,
    selectedId: string | null
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const pageModules = this.getModulesForPage(modules, page);

    const select = new StringSelectMenuBuilder()
      .setCustomId('modules:select')
      .setPlaceholder('Select a module to manage...')
      .addOptions(
        pageModules.map((status) => {
          const loadedInfo = status.loaded ? '' : ' (Not Loaded)';
          const option = new StringSelectMenuOptionBuilder()
            .setLabel(status.metadata.name)
            .setDescription(
              (status.enabled ? 'Enabled' : 'Disabled') + loadedInfo
            )
            .setValue(status.metadata.id)
            .setEmoji(status.enabled ? '\u2705' : '\u274C');

          if (selectedId === status.metadata.id) {
            option.setDefault(true);
          }

          return option;
        })
      );

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /**
   * Create navigation buttons (pagination)
   */
  static createNavButtons(
    page: number,
    totalPages: number,
    isAdmin: boolean,
    showAll: boolean
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    // Previous page
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('modules:prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0)
    );

    // Page indicator (not clickable)
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('modules:page')
        .setLabel(`${page + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    // Next page
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('modules:next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

    // Show all toggle (admin only)
    if (isAdmin) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId('modules:toggle_all')
          .setLabel(showAll ? 'Public Only' : 'Show All')
          .setStyle(ButtonStyle.Primary)
      );
    }

    return row;
  }

  /**
   * Create action buttons for selected module (admin only)
   */
  static createActionButtons(
    status: ModuleStatus
  ): ActionRowBuilder<ButtonBuilder> {
    const { metadata, enabled } = status;
    const isCore = metadata.isCore;

    const row = new ActionRowBuilder<ButtonBuilder>();

    // Back button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('modules:back')
        .setLabel('Back to List')
        .setStyle(ButtonStyle.Secondary)
    );

    // Enable/Disable button
    if (enabled) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`modules:disable:${metadata.id}`)
          .setLabel('Disable')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(isCore)
      );
    } else {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`modules:enable:${metadata.id}`)
          .setLabel('Enable')
          .setStyle(ButtonStyle.Success)
      );
    }

    return row;
  }

  /**
   * Create components for list view
   */
  static createListComponents(
    modules: ModuleStatus[],
    page: number,
    isAdmin: boolean,
    showAll: boolean
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const totalPages = this.getTotalPages(modules.length);
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    // Module select (admin only, if there are modules on this page)
    if (isAdmin && modules.length > 0) {
      components.push(this.createModuleSelect(modules, page, null));
    }

    // Navigation buttons (only if needed)
    if (totalPages > 1 || isAdmin) {
      components.push(this.createNavButtons(page, totalPages, isAdmin, showAll));
    }

    return components;
  }

  /**
   * Create components for detail view
   */
  static createDetailComponents(
    status: ModuleStatus
  ): ActionRowBuilder<ButtonBuilder>[] {
    return [this.createActionButtons(status)];
  }
}
