import type {
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  PermissionResolvable,
  ContextMenuCommandBuilder,
  UserContextMenuCommandInteraction,
  MessageContextMenuCommandInteraction,
} from 'discord.js';

/**
 * Function signature for slash command execution
 */
export type SlashCommandExecute = (
  interaction: ChatInputCommandInteraction
) => Promise<void> | void;

/**
 * Function signature for autocomplete handling
 */
export type AutocompleteHandler = (
  interaction: AutocompleteInteraction
) => Promise<void> | void;

/**
 * Function signature for user context menu execution
 */
export type UserContextMenuExecute = (
  interaction: UserContextMenuCommandInteraction
) => Promise<void> | void;

/**
 * Function signature for message context menu execution
 */
export type MessageContextMenuExecute = (
  interaction: MessageContextMenuCommandInteraction
) => Promise<void> | void;

/**
 * Slash command builder types
 */
export type SlashCommandData =
  | SlashCommandBuilder
  | SlashCommandSubcommandsOnlyBuilder
  | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

/**
 * Base command definition shared by all command types
 */
interface BaseCommand {
  /** Module this command belongs to */
  moduleId?: string;

  /** Required permissions to use this command */
  permissions?: PermissionResolvable[];

  /** Whether the command can only be used in guilds */
  guildOnly?: boolean;

  /** Cooldown in seconds between uses */
  cooldown?: number;

  /** Whether to defer the reply (for long-running commands) */
  defer?: boolean;

  /** Whether the deferred reply should be ephemeral */
  ephemeral?: boolean;
}

/**
 * Slash command definition
 */
export interface SlashCommand extends BaseCommand {
  type: 'slash';

  /** Slash command builder data */
  data: SlashCommandData;

  /** Command execution handler */
  execute: SlashCommandExecute;

  /** Autocomplete handler (optional) */
  autocomplete?: AutocompleteHandler;
}

/**
 * User context menu command definition
 */
export interface UserContextMenuCommand extends BaseCommand {
  type: 'user';

  /** Context menu command builder data */
  data: ContextMenuCommandBuilder;

  /** Command execution handler */
  execute: UserContextMenuExecute;
}

/**
 * Message context menu command definition
 */
export interface MessageContextMenuCommand extends BaseCommand {
  type: 'message';

  /** Context menu command builder data */
  data: ContextMenuCommandBuilder;

  /** Command execution handler */
  execute: MessageContextMenuExecute;
}

/**
 * Union type for all command types
 */
export type ModuleCommand =
  | SlashCommand
  | UserContextMenuCommand
  | MessageContextMenuCommand;

/**
 * Helper to create a slash command definition
 */
export function defineSlashCommand(
  data: SlashCommandData,
  execute: SlashCommandExecute,
  options?: Omit<SlashCommand, 'type' | 'data' | 'execute'>
): SlashCommand {
  return {
    type: 'slash',
    data,
    execute,
    ...options,
  };
}

/**
 * Helper to create a user context menu command
 */
export function defineUserContextMenu(
  data: ContextMenuCommandBuilder,
  execute: UserContextMenuExecute,
  options?: Omit<UserContextMenuCommand, 'type' | 'data' | 'execute'>
): UserContextMenuCommand {
  return {
    type: 'user',
    data,
    execute,
    ...options,
  };
}

/**
 * Helper to create a message context menu command
 */
export function defineMessageContextMenu(
  data: ContextMenuCommandBuilder,
  execute: MessageContextMenuExecute,
  options?: Omit<MessageContextMenuCommand, 'type' | 'data' | 'execute'>
): MessageContextMenuCommand {
  return {
    type: 'message',
    data,
    execute,
    ...options,
  };
}

/**
 * Type guard for slash commands
 */
export function isSlashCommand(command: ModuleCommand): command is SlashCommand {
  return command.type === 'slash';
}

/**
 * Type guard for user context menu commands
 */
export function isUserContextMenu(
  command: ModuleCommand
): command is UserContextMenuCommand {
  return command.type === 'user';
}

/**
 * Type guard for message context menu commands
 */
export function isMessageContextMenu(
  command: ModuleCommand
): command is MessageContextMenuCommand {
  return command.type === 'message';
}
