import {
  Interaction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
  GuildMember,
  PermissionFlagsBits,
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { ModulesPanel, ModuleStatus, PanelState } from '../components/ModulesPanel.js';
import { SettingsPanel, SettingWithValue, SettingsPanelState } from '../components/SettingsPanel.js';
import { getClient } from '../../../bot.js';
import { Logger } from '../../../shared/utils/logger.js';
import { settingsRegistry } from '../../../core/settings/SettingsDefinition.js';
import { getModuleSettingsService } from '../../../core/settings/ModuleSettingsService.js';
import { getCodeStatsService } from '../services/CodeStatsService.js';
import { generateChart, ChartType } from '../services/ChartService.js';

const logger = new Logger('Admin:Interaction');

// Store panel states per message
const panelStates = new Map<string, PanelState>();
const settingsPanelStates = new Map<string, SettingsPanelState>();

export const interactionCreateEvent: AnyModuleEvent = {
  name: 'interactionCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const interaction = args[0] as Interaction;

    // Handle button interactions for modules
    if (interaction.isButton() && interaction.customId.startsWith('modules:')) {
      await handleButton(interaction);
      return;
    }

    // Handle select menu interactions for modules
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('modules:')) {
      await handleSelectMenu(interaction);
      return;
    }

    // Handle button interactions for settings
    if (interaction.isButton() && interaction.customId.startsWith('settings:')) {
      await handleSettingsButton(interaction);
      return;
    }

    // Handle select menu for setting option selection (settings:select:moduleId:key)
    // Must be checked BEFORE the general settings: handler
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('settings:select:')) {
      await handleSettingsSelectOption(interaction);
      return;
    }

    // Handle select menu interactions for settings (module_select, setting_select)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('settings:')) {
      await handleSettingsSelectMenu(interaction);
      return;
    }

    // Handle modal submissions for settings
    if (interaction.isModalSubmit() && interaction.customId.startsWith('settings:modal:')) {
      await handleSettingsModal(interaction);
      return;
    }

    // Handle lines chart buttons
    if (interaction.isButton() && interaction.customId.startsWith('lines_chart_')) {
      await handleLinesChartButton(interaction);
      return;
    }
  },
};

/**
 * Get or create panel state for a message
 */
function getState(messageId: string): PanelState {
  let state = panelStates.get(messageId);
  if (!state) {
    state = { page: 0, selectedModuleId: null, showAll: false };
    panelStates.set(messageId, state);
  }
  return state;
}

/**
 * Get module statuses for display
 * Returns all discovered modules, not just loaded ones
 */
async function getModuleStatuses(guildId: string, showAll: boolean): Promise<ModuleStatus[]> {
  const client = getClient();

  // Get all discovered modules (includes unloaded ones)
  let allMetadata = client.modules.getAllDiscoveredModules();

  // Filter to public modules unless showing all
  if (!showAll) {
    allMetadata = allMetadata.filter((m) => m.isPublic);
  }

  // Get enabled status and loaded status for each
  const statuses = await Promise.all(
    allMetadata.map(async (metadata) => {
      const enabled = await client.modules.isEnabledForGuild(metadata.id, guildId);
      const loaded = client.modules.isLoaded(metadata.id);
      const module = loaded ? client.modules.getModule(metadata.id) : undefined;
      return { metadata, module, enabled, loaded };
    })
  );

  // Sort: enabled first, then loaded, then alphabetically
  return statuses.sort((a, b) => {
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }
    if (a.loaded !== b.loaded) {
      return a.loaded ? -1 : 1;
    }
    return a.metadata.name.localeCompare(b.metadata.name);
  });
}

/**
 * Handle button interactions
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const [, action, moduleId] = interaction.customId.split(':');
  const messageId = interaction.message.id;
  const state = getState(messageId);
  const member = interaction.member as GuildMember | null;
  const isAdmin = ModulesPanel.isAdmin(member);
  const guildId = interaction.guildId!;
  const client = getClient();

  // Get current modules
  const modules = await getModuleStatuses(guildId, state.showAll);
  const totalPages = ModulesPanel.getTotalPages(modules.length);

  switch (action) {
    case 'prev':
      state.page = Math.max(0, state.page - 1);
      state.selectedModuleId = null;
      await updateListView(interaction, modules, state, isAdmin);
      break;

    case 'next':
      state.page = Math.min(totalPages - 1, state.page + 1);
      state.selectedModuleId = null;
      await updateListView(interaction, modules, state, isAdmin);
      break;

    case 'toggle_all':
      if (!isAdmin) {
        await interaction.reply({
          embeds: [ModulesPanel.createActionEmbed(false, 'Permission Denied', 'Only administrators can view all modules.')],
          ephemeral: true,
        });
        return;
      }
      state.showAll = !state.showAll;
      state.page = 0;
      state.selectedModuleId = null;
      const newModules = await getModuleStatuses(guildId, state.showAll);
      await updateListView(interaction, newModules, state, isAdmin);
      break;

    case 'back':
      state.selectedModuleId = null;
      await updateListView(interaction, modules, state, isAdmin);
      break;

    case 'enable':
      if (!isAdmin || !moduleId) {
        await interaction.reply({
          embeds: [ModulesPanel.createActionEmbed(false, 'Permission Denied', 'Only administrators can enable modules.')],
          ephemeral: true,
        });
        return;
      }
      await handleEnableModule(interaction, moduleId, guildId, state);
      break;

    case 'disable':
      if (!isAdmin || !moduleId) {
        await interaction.reply({
          embeds: [ModulesPanel.createActionEmbed(false, 'Permission Denied', 'Only administrators can disable modules.')],
          ephemeral: true,
        });
        return;
      }
      await handleDisableModule(interaction, moduleId, guildId, state);
      break;
  }
}

/**
 * Handle select menu interactions
 */
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const messageId = interaction.message.id;
  const state = getState(messageId);
  const member = interaction.member as GuildMember | null;
  const isAdmin = ModulesPanel.isAdmin(member);
  const guildId = interaction.guildId!;

  if (!isAdmin) {
    await interaction.reply({
      embeds: [ModulesPanel.createActionEmbed(false, 'Permission Denied', 'Only administrators can manage modules.')],
      ephemeral: true,
    });
    return;
  }

  const selectedModuleId = interaction.values[0];
  if (!selectedModuleId) return;

  state.selectedModuleId = selectedModuleId;

  // Get module status
  const modules = await getModuleStatuses(guildId, state.showAll);
  const selectedStatus = modules.find((m) => m.metadata.id === selectedModuleId);

  if (!selectedStatus) {
    await interaction.reply({
      embeds: [ModulesPanel.createActionEmbed(false, 'Module Not Found', 'The selected module could not be found.')],
      ephemeral: true,
    });
    return;
  }

  // Show detail view
  await interaction.update({
    embeds: [ModulesPanel.createDetailEmbed(selectedStatus, isAdmin)],
    components: ModulesPanel.createDetailComponents(selectedStatus),
  });
}

/**
 * Update to list view
 */
async function updateListView(
  interaction: ButtonInteraction,
  modules: ModuleStatus[],
  state: PanelState,
  isAdmin: boolean
): Promise<void> {
  await interaction.update({
    embeds: [ModulesPanel.createListEmbed(modules, state.page, isAdmin)],
    components: ModulesPanel.createListComponents(modules, state.page, isAdmin, state.showAll),
  });
}

/**
 * Handle enabling a module
 */
async function handleEnableModule(
  interaction: ButtonInteraction,
  moduleId: string,
  guildId: string,
  state: PanelState
): Promise<void> {
  const client = getClient();

  // Check if module is discovered (exists in registry)
  const allModules = client.modules.getAllDiscoveredModules();
  const moduleMetadata = allModules.find((m) => m.id === moduleId);

  if (!moduleMetadata) {
    await interaction.reply({
      embeds: [ModulesPanel.createActionEmbed(false, 'Module Not Found', `Module \`${moduleId}\` was not discovered.`)],
      ephemeral: true,
    });
    return;
  }

  try {
    // If module is not loaded, load it first
    if (!client.modules.isLoaded(moduleId)) {
      logger.info(`Loading module ${moduleId} before enabling...`);
      const loadSuccess = await client.modules.loadModule(moduleId);
      if (!loadSuccess) {
        await interaction.reply({
          embeds: [ModulesPanel.createActionEmbed(false, 'Failed to Load', `Module \`${moduleId}\` could not be loaded. Check the logs for details.`)],
          ephemeral: true,
        });
        return;
      }
    }

    await client.modules.enableForGuild(moduleId, guildId);

    // Get updated status
    const modules = await getModuleStatuses(guildId, state.showAll);
    const status = modules.find((m) => m.metadata.id === moduleId);

    if (status) {
      await interaction.update({
        embeds: [ModulesPanel.createDetailEmbed(status, true)],
        components: ModulesPanel.createDetailComponents(status),
      });
    }

    logger.info(`Module ${moduleId} enabled for guild ${guildId}`);
  } catch (error) {
    logger.error(`Failed to enable module ${moduleId}:`, error);
    await interaction.reply({
      embeds: [ModulesPanel.createActionEmbed(false, 'Failed to Enable', error instanceof Error ? error.message : 'Unknown error')],
      ephemeral: true,
    });
  }
}

/**
 * Handle disabling a module
 */
async function handleDisableModule(
  interaction: ButtonInteraction,
  moduleId: string,
  guildId: string,
  state: PanelState
): Promise<void> {
  const client = getClient();

  // Check if module is discovered (exists in registry)
  const allModules = client.modules.getAllDiscoveredModules();
  const moduleMetadata = allModules.find((m) => m.id === moduleId);

  if (!moduleMetadata) {
    await interaction.reply({
      embeds: [ModulesPanel.createActionEmbed(false, 'Module Not Found', `Module \`${moduleId}\` was not discovered.`)],
      ephemeral: true,
    });
    return;
  }

  if (moduleMetadata.isCore) {
    await interaction.reply({
      embeds: [ModulesPanel.createActionEmbed(false, 'Cannot Disable', `**${moduleMetadata.name}** is a core module and cannot be disabled.`)],
      ephemeral: true,
    });
    return;
  }

  try {
    await client.modules.disableForGuild(moduleId, guildId);

    // Get updated status
    const modules = await getModuleStatuses(guildId, state.showAll);
    const status = modules.find((m) => m.metadata.id === moduleId);

    if (status) {
      await interaction.update({
        embeds: [ModulesPanel.createDetailEmbed(status, true)],
        components: ModulesPanel.createDetailComponents(status),
      });
    }

    logger.info(`Module ${moduleId} disabled for guild ${guildId}`);
  } catch (error) {
    logger.error(`Failed to disable module ${moduleId}:`, error);
    await interaction.reply({
      embeds: [ModulesPanel.createActionEmbed(false, 'Failed to Disable', error instanceof Error ? error.message : 'Unknown error')],
      ephemeral: true,
    });
  }
}

// ==========================================
// Settings Panel Handlers
// ==========================================

/**
 * Check if member is an administrator
 */
function isAdministrator(member: GuildMember | null): boolean {
  return member?.permissions.has(PermissionFlagsBits.Administrator) ?? false;
}

/**
 * Get or create settings panel state
 */
function getSettingsState(messageId: string): SettingsPanelState {
  let state = settingsPanelStates.get(messageId);
  if (!state) {
    state = { moduleId: null, page: 0, selectedSettingKey: null };
    settingsPanelStates.set(messageId, state);
  }
  return state;
}

/**
 * Get settings with their current values for a module
 */
async function getSettingsWithValues(moduleId: string, guildId: string): Promise<SettingWithValue[]> {
  const settingsService = getModuleSettingsService();
  if (!settingsService) return [];

  const definitions = settingsRegistry.getModuleSettings(moduleId);
  const values = await settingsService.getSettings(moduleId, guildId);

  return definitions.map((setting) => ({
    setting,
    value: values[setting.key],
    isDefault: values[setting.key] === setting.defaultValue,
  }));
}

/**
 * Handle settings button interactions
 */
async function handleSettingsButton(interaction: ButtonInteraction): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!isAdministrator(member)) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Permission Denied', 'Only administrators can manage settings.')],
      ephemeral: true,
    });
    return;
  }

  const parts = interaction.customId.split(':');
  const action = parts[1];
  const messageId = interaction.message.id;
  const state = getSettingsState(messageId);
  const guildId = interaction.guildId!;

  switch (action) {
    case 'back_modules':
      // Go back to module list
      state.moduleId = null;
      state.page = 0;
      state.selectedSettingKey = null;
      await interaction.update({
        embeds: [SettingsPanel.createModuleListEmbed()],
        components: SettingsPanel.createModuleListComponents(),
      });
      break;

    case 'back_list':
      // Go back to settings list
      if (state.moduleId) {
        state.selectedSettingKey = null;
        const settings = await getSettingsWithValues(state.moduleId, guildId);
        const schema = settingsRegistry.getSchema(state.moduleId);
        await interaction.update({
          embeds: [SettingsPanel.createSettingsListEmbed(state.moduleId, schema?.moduleName ?? state.moduleId, settings, state.page)],
          components: SettingsPanel.createSettingsListComponents(settings, state.page),
        });
      }
      break;

    case 'prev':
      if (state.moduleId) {
        state.page = Math.max(0, state.page - 1);
        const settings = await getSettingsWithValues(state.moduleId, guildId);
        const schema = settingsRegistry.getSchema(state.moduleId);
        await interaction.update({
          embeds: [SettingsPanel.createSettingsListEmbed(state.moduleId, schema?.moduleName ?? state.moduleId, settings, state.page)],
          components: SettingsPanel.createSettingsListComponents(settings, state.page),
        });
      }
      break;

    case 'next':
      if (state.moduleId) {
        const settings = await getSettingsWithValues(state.moduleId, guildId);
        const totalPages = SettingsPanel.getTotalPages(settings.length);
        state.page = Math.min(totalPages - 1, state.page + 1);
        const schema = settingsRegistry.getSchema(state.moduleId);
        await interaction.update({
          embeds: [SettingsPanel.createSettingsListEmbed(state.moduleId, schema?.moduleName ?? state.moduleId, settings, state.page)],
          components: SettingsPanel.createSettingsListComponents(settings, state.page),
        });
      }
      break;

    case 'edit':
      if (parts[2] && parts[3]) {
        await handleSettingsEdit(interaction, parts[2], parts[3], guildId);
      }
      break;

    case 'reset':
      if (parts[2] && parts[3]) {
        await handleSettingsReset(interaction, parts[2], parts[3], guildId, state);
      }
      break;

    case 'bool':
      // Boolean toggle: settings:bool:moduleId:key:value
      if (parts[2] && parts[3] && parts[4]) {
        await handleSettingsBoolToggle(interaction, parts[2], parts[3], parts[4] === 'true', guildId, state);
      }
      break;
  }
}

/**
 * Handle settings select menu interactions
 */
async function handleSettingsSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!isAdministrator(member)) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Permission Denied', 'Only administrators can manage settings.')],
      ephemeral: true,
    });
    return;
  }

  const customId = interaction.customId;
  const messageId = interaction.message.id;
  const state = getSettingsState(messageId);
  const guildId = interaction.guildId!;
  const selectedValue = interaction.values[0];

  if (customId === 'settings:module_select') {
    // Module was selected - show its settings
    state.moduleId = selectedValue ?? null;
    state.page = 0;
    state.selectedSettingKey = null;

    if (!selectedValue) return;

    const settings = await getSettingsWithValues(selectedValue, guildId);
    const schema = settingsRegistry.getSchema(selectedValue);

    await interaction.update({
      embeds: [SettingsPanel.createSettingsListEmbed(selectedValue, schema?.moduleName ?? selectedValue, settings, 0)],
      components: SettingsPanel.createSettingsListComponents(settings, 0),
    });
  } else if (customId === 'settings:setting_select') {
    // Setting was selected - show its detail view
    if (!state.moduleId) return;

    state.selectedSettingKey = selectedValue ?? null;

    const settings = await getSettingsWithValues(state.moduleId, guildId);
    const selectedSetting = settings.find((s) => s.setting.key === selectedValue);

    if (!selectedSetting) {
      await interaction.reply({
        embeds: [SettingsPanel.createActionEmbed(false, 'Setting Not Found', 'The selected setting could not be found.')],
        ephemeral: true,
      });
      return;
    }

    await interaction.update({
      embeds: [SettingsPanel.createSettingDetailEmbed(selectedSetting.setting, selectedSetting.value, selectedSetting.isDefault)],
      components: SettingsPanel.createSettingDetailComponents(selectedSetting.setting, selectedSetting.isDefault, selectedSetting.value),
    });
  }
}

/**
 * Handle settings edit button - show modal
 */
async function handleSettingsEdit(
  interaction: ButtonInteraction,
  moduleId: string,
  key: string,
  guildId: string
): Promise<void> {
  const settingsService = getModuleSettingsService();
  if (!settingsService) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Error', 'Settings service is not available.')],
      ephemeral: true,
    });
    return;
  }

  const setting = settingsRegistry.getSetting(moduleId, key);
  if (!setting) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Setting Not Found', `Setting \`${key}\` not found in module \`${moduleId}\`.`)],
      ephemeral: true,
    });
    return;
  }

  const currentValue = await settingsService.getSetting(moduleId, guildId, key);
  const schema = settingsRegistry.getSchema(moduleId);
  const registeredSetting = {
    ...setting,
    moduleId,
    moduleName: schema?.moduleName ?? moduleId,
  };

  const modal = SettingsPanel.createEditModal(registeredSetting, currentValue);
  await interaction.showModal(modal);
}

/**
 * Handle settings reset button
 */
async function handleSettingsReset(
  interaction: ButtonInteraction,
  moduleId: string,
  key: string,
  guildId: string,
  state: SettingsPanelState
): Promise<void> {
  const settingsService = getModuleSettingsService();
  if (!settingsService) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Error', 'Settings service is not available.')],
      ephemeral: true,
    });
    return;
  }

  const setting = settingsRegistry.getSetting(moduleId, key);
  if (!setting) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Setting Not Found', `Setting \`${key}\` not found.`)],
      ephemeral: true,
    });
    return;
  }

  const result = await settingsService.resetSetting(moduleId, guildId, key);

  if (!result.success) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Reset Failed', result.error ?? 'Unknown error')],
      ephemeral: true,
    });
    return;
  }

  logger.info(`Reset setting ${moduleId}.${key} to default for guild ${guildId}`);

  // Update the view
  const settings = await getSettingsWithValues(moduleId, guildId);
  const updatedSetting = settings.find((s) => s.setting.key === key);
  const schema = settingsRegistry.getSchema(moduleId);
  const registeredSetting = {
    ...setting,
    moduleId,
    moduleName: schema?.moduleName ?? moduleId,
  };

  if (updatedSetting) {
    await interaction.update({
      embeds: [SettingsPanel.createSettingDetailEmbed(registeredSetting, updatedSetting.value, updatedSetting.isDefault)],
      components: SettingsPanel.createSettingDetailComponents(registeredSetting, updatedSetting.isDefault, updatedSetting.value),
    });
  }
}

/**
 * Handle settings modal submission
 */
async function handleSettingsModal(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(':');
  const moduleId = parts[2];
  const key = parts[3];
  const guildId = interaction.guildId!;

  if (!moduleId || !key) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Error', 'Invalid setting identifier.')],
      ephemeral: true,
    });
    return;
  }

  const settingsService = getModuleSettingsService();
  if (!settingsService) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Error', 'Settings service is not available.')],
      ephemeral: true,
    });
    return;
  }

  const setting = settingsRegistry.getSetting(moduleId, key);
  if (!setting) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Setting Not Found', `Setting \`${key}\` not found.`)],
      ephemeral: true,
    });
    return;
  }

  // Get the input value
  const rawValue = interaction.fields.getTextInputValue('value');

  // Parse the value based on type
  const parsedValue = settingsRegistry.parseValue(moduleId, key, rawValue);

  // Try to set the value
  const result = await settingsService.setSetting(moduleId, guildId, key, parsedValue);

  if (!result.success) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Validation Error', result.error ?? 'Invalid value')],
      ephemeral: true,
    });
    return;
  }

  logger.info(`Updated setting ${moduleId}.${key} = ${parsedValue} for guild ${guildId}`);

  // Update the view with the new value
  const settings = await getSettingsWithValues(moduleId, guildId);
  const updatedSetting = settings.find((s) => s.setting.key === key);
  const schema = settingsRegistry.getSchema(moduleId);
  const registeredSetting = {
    ...setting,
    moduleId,
    moduleName: schema?.moduleName ?? moduleId,
  };

  if (updatedSetting) {
    // Use deferUpdate and editReply for modal submissions that update the original message
    await interaction.deferUpdate();
    await interaction.editReply({
      embeds: [SettingsPanel.createSettingDetailEmbed(registeredSetting, updatedSetting.value, updatedSetting.isDefault)],
      components: SettingsPanel.createSettingDetailComponents(registeredSetting, updatedSetting.isDefault, updatedSetting.value),
    });
  } else {
    // Fallback - just acknowledge with a success message
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(true, 'Setting Updated', `**${setting.name}** has been updated.`)],
      ephemeral: true,
    });
  }
}

/**
 * Handle boolean toggle button click
 */
async function handleSettingsBoolToggle(
  interaction: ButtonInteraction,
  moduleId: string,
  key: string,
  value: boolean,
  guildId: string,
  state: SettingsPanelState
): Promise<void> {
  const settingsService = getModuleSettingsService();
  if (!settingsService) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Error', 'Settings service is not available.')],
      ephemeral: true,
    });
    return;
  }

  const setting = settingsRegistry.getSetting(moduleId, key);
  if (!setting) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Setting Not Found', `Setting \`${key}\` not found.`)],
      ephemeral: true,
    });
    return;
  }

  // Set the new boolean value
  const result = await settingsService.setSetting(moduleId, guildId, key, value);

  if (!result.success) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Update Failed', result.error ?? 'Unknown error')],
      ephemeral: true,
    });
    return;
  }

  logger.info(`Toggled setting ${moduleId}.${key} = ${value} for guild ${guildId}`);

  // Update the view
  const settings = await getSettingsWithValues(moduleId, guildId);
  const updatedSetting = settings.find((s) => s.setting.key === key);
  const schema = settingsRegistry.getSchema(moduleId);
  const registeredSetting = {
    ...setting,
    moduleId,
    moduleName: schema?.moduleName ?? moduleId,
  };

  if (updatedSetting) {
    await interaction.update({
      embeds: [SettingsPanel.createSettingDetailEmbed(registeredSetting, updatedSetting.value, updatedSetting.isDefault)],
      components: SettingsPanel.createSettingDetailComponents(registeredSetting, updatedSetting.isDefault, updatedSetting.value),
    });
  }
}

/**
 * Handle select option change from dropdown
 */
async function handleSettingsSelectOption(interaction: StringSelectMenuInteraction): Promise<void> {
  const member = interaction.member as GuildMember | null;
  if (!isAdministrator(member)) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Permission Denied', 'Only administrators can manage settings.')],
      ephemeral: true,
    });
    return;
  }

  // Parse customId: settings:select:moduleId:key
  const parts = interaction.customId.split(':');
  const moduleId = parts[2];
  const key = parts[3];
  const selectedValue = interaction.values[0];
  const guildId = interaction.guildId!;

  if (!moduleId || !key || !selectedValue) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Error', 'Invalid selection.')],
      ephemeral: true,
    });
    return;
  }

  const settingsService = getModuleSettingsService();
  if (!settingsService) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Error', 'Settings service is not available.')],
      ephemeral: true,
    });
    return;
  }

  const setting = settingsRegistry.getSetting(moduleId, key);
  if (!setting) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Setting Not Found', `Setting \`${key}\` not found.`)],
      ephemeral: true,
    });
    return;
  }

  // Set the new value
  const result = await settingsService.setSetting(moduleId, guildId, key, selectedValue);

  if (!result.success) {
    await interaction.reply({
      embeds: [SettingsPanel.createActionEmbed(false, 'Update Failed', result.error ?? 'Unknown error')],
      ephemeral: true,
    });
    return;
  }

  logger.info(`Updated setting ${moduleId}.${key} = ${selectedValue} for guild ${guildId}`);

  // Update the view
  const settings = await getSettingsWithValues(moduleId, guildId);
  const updatedSetting = settings.find((s) => s.setting.key === key);
  const schema = settingsRegistry.getSchema(moduleId);
  const registeredSetting = {
    ...setting,
    moduleId,
    moduleName: schema?.moduleName ?? moduleId,
  };

  if (updatedSetting) {
    await interaction.update({
      embeds: [SettingsPanel.createSettingDetailEmbed(registeredSetting, updatedSetting.value, updatedSetting.isDefault)],
      components: SettingsPanel.createSettingDetailComponents(registeredSetting, updatedSetting.isDefault, updatedSetting.value),
    });
  }
}

// ==========================================
// Lines Chart Handlers
// ==========================================

/**
 * Handle lines chart button clicks - updates the original message with the chart
 */
async function handleLinesChartButton(interaction: ButtonInteraction): Promise<void> {
  const chartType = interaction.customId.replace('lines_chart_', '') as ChartType;

  const codeStatsService = getCodeStatsService();
  if (!codeStatsService) {
    await interaction.reply({
      content: 'Code stats service is not available.',
      ephemeral: true,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    // Get history data
    const history = await codeStatsService.getHistory(1000);

    if (history.length < 2) {
      await interaction.followUp({
        content: 'Not enough data to generate a chart. Need at least 2 snapshots.',
        ephemeral: true,
      });
      return;
    }

    // Generate the chart
    const chartBuffer = await generateChart(chartType, history);

    // Create attachment
    const attachment = new AttachmentBuilder(chartBuffer, {
      name: `code-stats-${chartType}.png`,
    });

    // Create embed with chart title
    const titles: Record<ChartType, string> = {
      lines: 'Lines of Code Over Time',
      files: 'File Count Over Time',
      modules: 'Module Count Over Time',
      breakdown: 'Current Code Breakdown',
    };

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(titles[chartType])
      .setImage(`attachment://code-stats-${chartType}.png`)
      .setFooter({ text: `Based on ${history.length} snapshots` })
      .setTimestamp();

    // Build buttons with the current one highlighted
    const row = buildChartButtons(chartType);

    await interaction.editReply({
      embeds: [embed],
      files: [attachment],
      components: [row],
    });
  } catch (error) {
    logger.error('Failed to generate chart:', error);
    await interaction.followUp({
      content: `Failed to generate chart: ${error instanceof Error ? error.message : 'Unknown error'}`,
      ephemeral: true,
    });
  }
}

/**
 * Build chart button row with the active button highlighted
 */
function buildChartButtons(activeType: ChartType): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('lines_chart_lines')
      .setLabel('Lines Graph')
      .setEmoji('📈')
      .setStyle(activeType === 'lines' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lines_chart_files')
      .setLabel('Files Graph')
      .setEmoji('📁')
      .setStyle(activeType === 'files' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lines_chart_modules')
      .setLabel('Modules Graph')
      .setEmoji('📦')
      .setStyle(activeType === 'modules' ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('lines_chart_breakdown')
      .setLabel('Breakdown')
      .setEmoji('🍩')
      .setStyle(activeType === 'breakdown' ? ButtonStyle.Primary : ButtonStyle.Secondary)
  );
}
