import {
  REST,
  Routes,
  Collection,
  Client,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  ContextMenuCommandInteraction,
  Interaction,
  ApplicationCommandPermissionType,
} from 'discord.js';
import type { BotModule, ModuleCommand } from '../../types/module.types.js';
import { isSlashCommand, isUserContextMenu, isMessageContextMenu } from '../../types/command.types.js';
import { env, isDevelopment } from '../../config/environment.js';
import { Logger } from '../../shared/utils/logger.js';
import { errorEmbed } from '../../shared/utils/embed.js';

/** Structure for command permission updates */
interface GuildCommandPermission {
  id: string; // Command ID
  permissions: Array<{
    id: string; // Role/User/Channel ID (guild ID for @everyone)
    type: ApplicationCommandPermissionType;
    permission: boolean;
  }>;
}

const logger = new Logger('CommandManager');

/**
 * Manages slash command registration and execution.
 */
export class CommandManager {
  private client: Client;
  private rest: REST;

  /** All registered commands by name */
  private commands: Collection<string, ModuleCommand> = new Collection();

  /** Commands grouped by module ID */
  private moduleCommands: Map<string, string[]> = new Map();

  /** Cooldowns for commands */
  private cooldowns: Collection<string, Collection<string, number>> = new Collection();

  /** Callback to get module instance */
  private getModule?: (moduleId: string) => BotModule | undefined;

  /** Callback to check if module is enabled for a guild */
  private isModuleEnabled?: (moduleId: string, guildId: string) => Promise<boolean>;

  constructor(client: Client) {
    this.client = client;
    this.rest = new REST({ version: '10' }).setToken(env.BOT_TOKEN);
  }

  /**
   * Set callback to get module instances
   */
  setModuleGetter(getter: (moduleId: string) => BotModule | undefined): void {
    this.getModule = getter;
  }

  /**
   * Set callback to check module enabled status for a guild
   */
  setModuleEnabledChecker(
    checker: (moduleId: string, guildId: string) => Promise<boolean>
  ): void {
    this.isModuleEnabled = checker;
  }

  /**
   * Register commands from a module
   * @param module The module to register commands from
   * @param deploy Whether to deploy commands to Discord API (default: true)
   */
  async registerModuleCommands(module: BotModule, deploy: boolean = true): Promise<void> {
    const moduleId = module.metadata.id;
    const commandNames: string[] = [];

    for (const command of module.commands) {
      const name = command.data.name;

      // Set module ID on command
      command.moduleId = moduleId;

      // Store command
      this.commands.set(name, command);
      commandNames.push(name);

      logger.debug(`Registered command: ${name} (module: ${moduleId})`);
    }

    this.moduleCommands.set(moduleId, commandNames);
    logger.info(`Registered ${commandNames.length} command(s) from module: ${moduleId}`);

    // Deploy to Discord API if requested (runtime module loading)
    if (deploy && commandNames.length > 0) {
      await this.deployCommands();
    }
  }

  /**
   * Unregister commands from a module
   * @param moduleId The module ID to unregister commands from
   * @param deploy Whether to deploy updated commands to Discord API (default: true)
   */
  async unregisterModuleCommands(moduleId: string, deploy: boolean = true): Promise<void> {
    const commandNames = this.moduleCommands.get(moduleId) || [];

    for (const name of commandNames) {
      this.commands.delete(name);
      this.cooldowns.delete(name);
    }

    this.moduleCommands.delete(moduleId);
    logger.info(`Unregistered ${commandNames.length} command(s) from module: ${moduleId}`);

    // Re-deploy to Discord API to remove the commands
    if (deploy && commandNames.length > 0) {
      await this.deployCommands();
    }
  }

  /**
   * Deploy commands to Discord API
   * Call this after all modules are loaded
   */
  async deployCommands(): Promise<void> {
    const commandData = this.commands.map(cmd => cmd.data.toJSON());

    if (commandData.length === 0) {
      logger.warn('No commands to deploy');
      return;
    }

    try {
      logger.info(`Deploying ${commandData.length} command(s)...`);

      if (isDevelopment && env.DEV_GUILD_ID) {
        // Guild commands for development (instant update)
        await this.rest.put(
          Routes.applicationGuildCommands(env.CLIENT_ID, env.DEV_GUILD_ID),
          { body: commandData }
        );
        logger.info(`Deployed ${commandData.length} guild command(s) to ${env.DEV_GUILD_ID}`);
      } else {
        // Global commands for production (up to 1 hour propagation)
        await this.rest.put(
          Routes.applicationCommands(env.CLIENT_ID),
          { body: commandData }
        );
        logger.info(`Deployed ${commandData.length} global command(s)`);
      }

    } catch (error) {
      logger.error('Failed to deploy commands:', error);
      throw error;
    }
  }

  /**
   * Handle an incoming interaction
   */
  async handleInteraction(interaction: Interaction): Promise<void> {
    if (interaction.isChatInputCommand()) {
      await this.handleSlashCommand(interaction);
    } else if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(interaction);
    } else if (interaction.isContextMenuCommand()) {
      await this.handleContextMenu(interaction);
    }
  }

  /**
   * Handle a slash command interaction
   */
  private async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command || !isSlashCommand(command)) {
      logger.warn(`Unknown command: ${interaction.commandName}`);
      return;
    }

    // Check if module is enabled for this guild
    if (command.moduleId && interaction.guildId && this.isModuleEnabled) {
      const enabled = await this.isModuleEnabled(command.moduleId, interaction.guildId);
      if (!enabled) {
        logger.debug(`Command ${interaction.commandName} blocked - module ${command.moduleId} disabled for guild ${interaction.guildId}`);
        await interaction.reply({
          embeds: [errorEmbed('Module Disabled', 'This command is not available because the module is disabled for this server.')],
          ephemeral: true,
        });
        return;
      }
    }

    // Check guild-only restriction
    if (command.guildOnly && !interaction.guildId) {
      await interaction.reply({
        embeds: [errorEmbed('Server Only', 'This command can only be used in a server.')],
        ephemeral: true,
      });
      return;
    }

    // Check cooldown
    if (command.cooldown) {
      const cooldownResult = this.checkCooldown(
        interaction.commandName,
        interaction.user.id,
        command.cooldown
      );

      if (cooldownResult.onCooldown) {
        await interaction.reply({
          embeds: [errorEmbed(
            'Cooldown',
            `Please wait ${cooldownResult.remaining?.toFixed(1)} seconds before using this command again.`
          )],
          ephemeral: true,
        });
        return;
      }
    }

    // Check permissions
    if (command.permissions && interaction.memberPermissions) {
      const missing = command.permissions.filter(
        perm => !interaction.memberPermissions?.has(perm)
      );

      if (missing.length > 0) {
        await interaction.reply({
          embeds: [errorEmbed(
            'Missing Permissions',
            `You need the following permissions: ${missing.join(', ')}`
          )],
          ephemeral: true,
        });
        return;
      }
    }

    try {
      // Defer if requested
      if (command.defer) {
        await interaction.deferReply({ ephemeral: command.ephemeral });
      }

      // Execute command
      await command.execute(interaction);

    } catch (error) {
      logger.error(`Error executing command ${interaction.commandName}:`, error);

      const errorMessage = 'An error occurred while executing this command.';
      const embed = errorEmbed('Command Error', errorMessage);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }

  /**
   * Handle autocomplete interaction
   */
  private async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command || !isSlashCommand(command) || !command.autocomplete) {
      return;
    }

    // Check if module is enabled for this guild
    if (command.moduleId && interaction.guildId && this.isModuleEnabled) {
      const enabled = await this.isModuleEnabled(command.moduleId, interaction.guildId);
      if (!enabled) {
        await interaction.respond([]);
        return;
      }
    }

    try {
      await command.autocomplete(interaction);
    } catch (error) {
      logger.error(`Error in autocomplete for ${interaction.commandName}:`, error);
      await interaction.respond([]);
    }
  }

  /**
   * Handle context menu interaction
   */
  private async handleContextMenu(interaction: ContextMenuCommandInteraction): Promise<void> {
    const command = this.commands.get(interaction.commandName);

    if (!command) {
      return;
    }

    // Check if module is enabled for this guild
    if (command.moduleId && interaction.guildId && this.isModuleEnabled) {
      const enabled = await this.isModuleEnabled(command.moduleId, interaction.guildId);
      if (!enabled) {
        logger.debug(`Context menu ${interaction.commandName} blocked - module ${command.moduleId} disabled for guild ${interaction.guildId}`);
        await interaction.reply({
          embeds: [errorEmbed('Module Disabled', 'This command is not available because the module is disabled for this server.')],
          ephemeral: true,
        });
        return;
      }
    }

    try {
      if (isUserContextMenu(command) && interaction.isUserContextMenuCommand()) {
        await command.execute(interaction);
      } else if (isMessageContextMenu(command) && interaction.isMessageContextMenuCommand()) {
        await command.execute(interaction);
      }
    } catch (error) {
      logger.error(`Error executing context menu ${interaction.commandName}:`, error);

      const embed = errorEmbed('Command Error', 'An error occurred while executing this command.');

      if (interaction.replied || interaction.deferred) {
        await interaction.editReply({ embeds: [embed] });
      } else {
        await interaction.reply({ embeds: [embed], ephemeral: true });
      }
    }
  }

  /**
   * Check command cooldown
   */
  private checkCooldown(
    commandName: string,
    userId: string,
    cooldownSeconds: number
  ): { onCooldown: boolean; remaining?: number } {
    if (!this.cooldowns.has(commandName)) {
      this.cooldowns.set(commandName, new Collection());
    }

    const timestamps = this.cooldowns.get(commandName)!;
    const cooldownMs = cooldownSeconds * 1000;
    const now = Date.now();

    const expirationTime = timestamps.get(userId);

    if (expirationTime && now < expirationTime) {
      const remaining = (expirationTime - now) / 1000;
      return { onCooldown: true, remaining };
    }

    timestamps.set(userId, now + cooldownMs);

    // Clean up old entries
    setTimeout(() => timestamps.delete(userId), cooldownMs);

    return { onCooldown: false };
  }

  /**
   * Get a command by name
   */
  getCommand(name: string): ModuleCommand | undefined {
    return this.commands.get(name);
  }

  /**
   * Get all commands for a module
   */
  getModuleCommands(moduleId: string): ModuleCommand[] {
    const names = this.moduleCommands.get(moduleId) || [];
    return names.map(n => this.commands.get(n)!).filter(Boolean);
  }

  /**
   * Get all registered commands
   */
  getAllCommands(): ModuleCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get command count
   */
  getCommandCount(): number {
    return this.commands.size;
  }

  /**
   * Update command permissions for a module in a specific guild.
   * When enabled=false, disables all commands from the module for @everyone.
   * When enabled=true, removes the permission override (allows default behavior).
   */
  async updateModuleCommandPermissions(
    moduleId: string,
    guildId: string,
    enabled: boolean
  ): Promise<void> {
    const commandNames = this.moduleCommands.get(moduleId) || [];
    if (commandNames.length === 0) {
      return;
    }

    try {
      // Fetch the guild's registered commands to get their IDs
      const guildCommands = await this.client.application?.commands.fetch({ guildId });
      if (!guildCommands) {
        logger.warn(`Could not fetch commands for guild ${guildId}`);
        return;
      }

      // Build permission updates for each command in the module
      const permissionUpdates: GuildCommandPermission[] = [];

      for (const commandName of commandNames) {
        const registeredCommand = guildCommands.find(cmd => cmd.name === commandName);
        if (!registeredCommand) {
          // Command might be global, try to find it
          const globalCommands = await this.client.application?.commands.fetch();
          const globalCommand = globalCommands?.find(cmd => cmd.name === commandName);
          if (globalCommand) {
            if (enabled) {
              // Remove the @everyone deny permission (restore default)
              permissionUpdates.push({
                id: globalCommand.id,
                permissions: [], // Empty array removes all overrides
              });
            } else {
              // Deny the command for @everyone in this guild
              permissionUpdates.push({
                id: globalCommand.id,
                permissions: [
                  {
                    id: guildId, // Guild ID = @everyone role
                    type: ApplicationCommandPermissionType.Role,
                    permission: false,
                  },
                ],
              });
            }
          }
          continue;
        }

        if (enabled) {
          // Remove the @everyone deny permission (restore default)
          permissionUpdates.push({
            id: registeredCommand.id,
            permissions: [], // Empty array removes all overrides
          });
        } else {
          // Deny the command for @everyone in this guild
          permissionUpdates.push({
            id: registeredCommand.id,
            permissions: [
              {
                id: guildId, // Guild ID = @everyone role
                type: ApplicationCommandPermissionType.Role,
                permission: false,
              },
            ],
          });
        }
      }

      // Apply permission updates
      if (permissionUpdates.length > 0) {
        const guild = this.client.guilds.cache.get(guildId);
        if (guild) {
          for (const update of permissionUpdates) {
            try {
              if (update.permissions.length === 0) {
                // Clear all permissions for this command
                await this.rest.put(
                  Routes.applicationCommandPermissions(env.CLIENT_ID, guildId, update.id),
                  { body: { permissions: [] } }
                );
              } else {
                await this.rest.put(
                  Routes.applicationCommandPermissions(env.CLIENT_ID, guildId, update.id),
                  { body: { permissions: update.permissions } }
                );
              }
            } catch (permError) {
              // Permission update failed for this command, log and continue
              logger.debug(`Could not update permissions for command ${update.id}: ${permError}`);
            }
          }
          logger.info(
            `${enabled ? 'Enabled' : 'Disabled'} ${permissionUpdates.length} command(s) from module ${moduleId} for guild ${guildId}`
          );
        }
      }
    } catch (error) {
      logger.error(`Failed to update command permissions for module ${moduleId} in guild ${guildId}:`, error);
      // Don't throw - permission updates are best-effort
    }
  }
}
