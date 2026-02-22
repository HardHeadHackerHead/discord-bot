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
} from 'discord.js';
import { COLORS } from '../../../shared/utils/embed.js';
import { settingsRegistry, RegisteredSetting } from '../../../core/settings/SettingsDefinition.js';

const SETTINGS_PER_PAGE = 5;

export interface SettingWithValue {
  setting: RegisteredSetting;
  value: unknown;
  isDefault: boolean;
}

export interface SettingsPanelState {
  moduleId: string | null;
  page: number;
  selectedSettingKey: string | null;
}

/**
 * Component for the interactive settings panel
 */
export class SettingsPanel {
  /**
   * Get total pages for settings list
   */
  static getTotalPages(settingCount: number): number {
    return Math.max(1, Math.ceil(settingCount / SETTINGS_PER_PAGE));
  }

  /**
   * Get settings for a specific page
   */
  static getSettingsForPage(settings: SettingWithValue[], page: number): SettingWithValue[] {
    const start = page * SETTINGS_PER_PAGE;
    return settings.slice(start, start + SETTINGS_PER_PAGE);
  }

  /**
   * Create the module selection embed
   */
  static createModuleListEmbed(): EmbedBuilder {
    const modules = settingsRegistry.getModulesWithSettings();

    const embed = new EmbedBuilder()
      .setTitle('Module Settings')
      .setColor(COLORS.primary);

    if (modules.length === 0) {
      embed.setDescription('No modules have configurable settings.');
      return embed;
    }

    const lines = modules.map((m) => {
      const schema = settingsRegistry.getSchema(m.moduleId);
      const settingCount = schema?.settings.length ?? 0;
      return `**${m.moduleName}** (\`${m.moduleId}\`)\n└ ${settingCount} setting${settingCount !== 1 ? 's' : ''}`;
    });

    embed.setDescription(lines.join('\n\n'));
    embed.setFooter({ text: 'Select a module to view and configure its settings' });

    return embed;
  }

  /**
   * Create the settings list embed for a module
   */
  static createSettingsListEmbed(
    moduleId: string,
    moduleName: string,
    settings: SettingWithValue[],
    page: number
  ): EmbedBuilder {
    const totalPages = this.getTotalPages(settings.length);
    const pageSettings = this.getSettingsForPage(settings, page);

    const embed = new EmbedBuilder()
      .setTitle(`${moduleName} Settings`)
      .setColor(COLORS.primary);

    if (settings.length === 0) {
      embed.setDescription('This module has no configurable settings.');
      return embed;
    }

    const lines = pageSettings.map((s) => {
      const formattedValue = this.formatValue(s.setting, s.value);
      const defaultIndicator = s.isDefault ? ' `(default)`' : '';
      return `**${s.setting.name}**${defaultIndicator}\n└ ${formattedValue}\n  *${s.setting.description}*`;
    });

    embed.setDescription(lines.join('\n\n'));
    embed.setFooter({ text: `Page ${page + 1}/${totalPages} | Select a setting to modify` });

    return embed;
  }

  /**
   * Create the setting detail embed
   */
  static createSettingDetailEmbed(
    setting: RegisteredSetting,
    value: unknown,
    isDefault: boolean
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(setting.name)
      .setDescription(setting.description)
      .setColor(COLORS.primary);

    const formattedValue = this.formatValue(setting, value);
    const formattedDefault = this.formatValue(setting, setting.defaultValue);

    const fields = [
      { name: 'Current Value', value: formattedValue, inline: true },
      { name: 'Default Value', value: formattedDefault, inline: true },
      { name: 'Type', value: this.formatType(setting), inline: true },
    ];

    if (isDefault) {
      fields.push({ name: 'Status', value: 'Using default value', inline: false });
    }

    embed.addFields(fields);
    embed.setFooter({ text: `Module: ${setting.moduleName} | Key: ${setting.key}` });

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
   * Create module select dropdown
   */
  static createModuleSelect(): ActionRowBuilder<StringSelectMenuBuilder> {
    const modules = settingsRegistry.getModulesWithSettings();

    const select = new StringSelectMenuBuilder()
      .setCustomId('settings:module_select')
      .setPlaceholder('Select a module to configure...');

    if (modules.length === 0) {
      select.addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel('No modules available')
          .setValue('none')
          .setDescription('No modules have registered settings')
      );
      select.setDisabled(true);
    } else {
      select.addOptions(
        modules.map((m) => {
          const schema = settingsRegistry.getSchema(m.moduleId);
          const settingCount = schema?.settings.length ?? 0;
          return new StringSelectMenuOptionBuilder()
            .setLabel(m.moduleName)
            .setValue(m.moduleId)
            .setDescription(`${settingCount} setting${settingCount !== 1 ? 's' : ''}`);
        })
      );
    }

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /**
   * Create setting select dropdown
   */
  static createSettingSelect(
    settings: SettingWithValue[],
    page: number,
    selectedKey: string | null
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const pageSettings = this.getSettingsForPage(settings, page);

    const select = new StringSelectMenuBuilder()
      .setCustomId('settings:setting_select')
      .setPlaceholder('Select a setting to modify...')
      .addOptions(
        pageSettings.map((s) => {
          const shortValue = this.formatValueShort(s.setting, s.value);
          const option = new StringSelectMenuOptionBuilder()
            .setLabel(s.setting.name)
            .setValue(s.setting.key)
            .setDescription(`Current: ${shortValue}`);

          if (selectedKey === s.setting.key) {
            option.setDefault(true);
          }

          return option;
        })
      );

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /**
   * Create navigation buttons for settings list
   */
  static createNavButtons(
    page: number,
    totalPages: number,
    hasModule: boolean
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    // Back to modules button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('settings:back_modules')
        .setLabel('Back')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(!hasModule)
    );

    // Previous page
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('settings:prev')
        .setLabel('Previous')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page === 0)
    );

    // Page indicator
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('settings:page')
        .setLabel(`${page + 1} / ${totalPages}`)
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(true)
    );

    // Next page
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('settings:next')
        .setLabel('Next')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(page >= totalPages - 1)
    );

    return row;
  }

  /**
   * Create action buttons for setting detail view
   */
  static createSettingActionButtons(
    setting: RegisteredSetting,
    isDefault: boolean
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    // Back to list button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId('settings:back_list')
        .setLabel('Back to List')
        .setStyle(ButtonStyle.Secondary)
    );

    // Edit button - only for types that need a modal (number, string, channel, role)
    if (setting.type === 'number' || setting.type === 'string' || setting.type === 'channel' || setting.type === 'role') {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`settings:edit:${setting.moduleId}:${setting.key}`)
          .setLabel('Edit')
          .setStyle(ButtonStyle.Primary)
      );
    }

    // Reset to default button
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`settings:reset:${setting.moduleId}:${setting.key}`)
        .setLabel('Reset to Default')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(isDefault)
    );

    return row;
  }

  /**
   * Create toggle buttons for boolean settings
   */
  static createBooleanToggleButtons(
    setting: RegisteredSetting,
    currentValue: boolean
  ): ActionRowBuilder<ButtonBuilder> {
    const row = new ActionRowBuilder<ButtonBuilder>();

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`settings:bool:${setting.moduleId}:${setting.key}:true`)
        .setLabel('Enable')
        .setStyle(currentValue ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(currentValue)
    );

    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`settings:bool:${setting.moduleId}:${setting.key}:false`)
        .setLabel('Disable')
        .setStyle(!currentValue ? ButtonStyle.Danger : ButtonStyle.Secondary)
        .setDisabled(!currentValue)
    );

    return row;
  }

  /**
   * Create select menu for 'select' type settings
   */
  static createSelectOptionsMenu(
    setting: RegisteredSetting,
    currentValue: string
  ): ActionRowBuilder<StringSelectMenuBuilder> {
    const select = new StringSelectMenuBuilder()
      .setCustomId(`settings:select:${setting.moduleId}:${setting.key}`)
      .setPlaceholder('Choose an option...');

    if (setting.options && setting.options.length > 0) {
      select.addOptions(
        setting.options.map((opt) => {
          const option = new StringSelectMenuOptionBuilder()
            .setLabel(opt.label)
            .setValue(opt.value);

          if (opt.description) {
            option.setDescription(opt.description);
          }

          if (opt.value === currentValue) {
            option.setDefault(true);
          }

          return option;
        })
      );
    }

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  /**
   * Create components for module list view
   */
  static createModuleListComponents(): ActionRowBuilder<StringSelectMenuBuilder>[] {
    return [this.createModuleSelect()];
  }

  /**
   * Create components for settings list view
   */
  static createSettingsListComponents(
    settings: SettingWithValue[],
    page: number
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const totalPages = this.getTotalPages(settings.length);
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    if (settings.length > 0) {
      components.push(this.createSettingSelect(settings, page, null));
    }

    components.push(this.createNavButtons(page, totalPages, true));

    return components;
  }

  /**
   * Create components for setting detail view
   * Returns type-specific controls based on the setting type
   */
  static createSettingDetailComponents(
    setting: RegisteredSetting,
    isDefault: boolean,
    currentValue?: unknown
  ): ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] {
    const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

    // Add type-specific controls
    switch (setting.type) {
      case 'boolean':
        // Add toggle buttons for boolean settings
        components.push(this.createBooleanToggleButtons(setting, currentValue as boolean ?? setting.defaultValue as boolean));
        break;

      case 'select':
        // Add select menu for select-type settings
        components.push(this.createSelectOptionsMenu(setting, (currentValue as string) ?? (setting.defaultValue as string)));
        break;

      // number, string, channel, role use the Edit modal
    }

    // Add action buttons (Back, Edit for non-bool/select, Reset)
    components.push(this.createSettingActionButtons(setting, isDefault));

    return components;
  }

  /**
   * Create modal for editing a setting
   */
  static createEditModal(
    setting: RegisteredSetting,
    currentValue: unknown
  ): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId(`settings:modal:${setting.moduleId}:${setting.key}`)
      .setTitle(`Edit ${setting.name}`);

    const input = new TextInputBuilder()
      .setCustomId('value')
      .setLabel(this.getInputLabel(setting))
      .setStyle(TextInputStyle.Short)
      .setPlaceholder(this.getInputPlaceholder(setting))
      .setValue(this.formatValueRaw(setting, currentValue))
      .setRequired(setting.required ?? false);

    // Set min/max length hints for strings
    if (setting.type === 'string') {
      input.setMaxLength(1000);
    }

    const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
    modal.addComponents(row);

    return modal;
  }

  /**
   * Format a value for display
   */
  private static formatValue(setting: RegisteredSetting, value: unknown): string {
    if (value === null || value === undefined) {
      return '*not set*';
    }

    switch (setting.type) {
      case 'boolean':
        return value ? '`Enabled`' : '`Disabled`';

      case 'channel':
        return `<#${value}>`;

      case 'role':
        return `<@&${value}>`;

      case 'number':
        return `\`${value}\``;

      default:
        return `\`${String(value)}\``;
    }
  }

  /**
   * Format a value for short display (in dropdowns)
   */
  private static formatValueShort(setting: RegisteredSetting, value: unknown): string {
    if (value === null || value === undefined) {
      return 'not set';
    }

    switch (setting.type) {
      case 'boolean':
        return value ? 'Enabled' : 'Disabled';

      case 'channel':
      case 'role':
        return String(value).slice(0, 20);

      default:
        const str = String(value);
        return str.length > 20 ? str.slice(0, 17) + '...' : str;
    }
  }

  /**
   * Format a value as raw string for input
   */
  private static formatValueRaw(setting: RegisteredSetting, value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }

    switch (setting.type) {
      case 'boolean':
        return value ? 'true' : 'false';

      default:
        return String(value);
    }
  }

  /**
   * Format type info
   */
  private static formatType(setting: RegisteredSetting): string {
    switch (setting.type) {
      case 'number':
        const constraints: string[] = [];
        if (setting.min !== undefined) constraints.push(`min: ${setting.min}`);
        if (setting.max !== undefined) constraints.push(`max: ${setting.max}`);
        return constraints.length > 0 ? `Number (${constraints.join(', ')})` : 'Number';

      case 'boolean':
        return 'Boolean (true/false)';

      case 'channel':
        return 'Channel ID';

      case 'role':
        return 'Role ID';

      default:
        return 'Text';
    }
  }

  /**
   * Get input label for modal
   */
  private static getInputLabel(setting: RegisteredSetting): string {
    switch (setting.type) {
      case 'boolean':
        return 'Value (true or false)';

      case 'number':
        const constraints: string[] = [];
        if (setting.min !== undefined) constraints.push(`min ${setting.min}`);
        if (setting.max !== undefined) constraints.push(`max ${setting.max}`);
        return constraints.length > 0 ? `Value (${constraints.join(', ')})` : 'Value (number)';

      case 'channel':
        return 'Channel ID';

      case 'role':
        return 'Role ID';

      default:
        return 'Value';
    }
  }

  /**
   * Get placeholder text for modal input
   */
  private static getInputPlaceholder(setting: RegisteredSetting): string {
    switch (setting.type) {
      case 'boolean':
        return 'true or false';

      case 'number':
        return `Enter a number${setting.min !== undefined ? ` (min: ${setting.min})` : ''}`;

      case 'channel':
        return 'Enter a channel ID (e.g., 123456789012345678)';

      case 'role':
        return 'Enter a role ID (e.g., 123456789012345678)';

      default:
        return `Enter ${setting.name.toLowerCase()}`;
    }
  }
}
