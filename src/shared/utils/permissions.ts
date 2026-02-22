import {
  GuildMember,
  PermissionResolvable,
  ChatInputCommandInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { isBotOwner } from '../../config/environment.js';
import { errorEmbed } from './embed.js';

/**
 * Permission check result
 */
export interface PermissionCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a user is a bot owner
 */
export function checkBotOwner(userId: string): PermissionCheckResult {
  if (isBotOwner(userId)) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason: 'This command can only be used by bot owners.',
  };
}

/**
 * Check if a member has the required Discord permissions
 */
export function checkDiscordPermissions(
  member: GuildMember | null,
  permissions: PermissionResolvable[]
): PermissionCheckResult {
  if (!member) {
    return {
      allowed: false,
      reason: 'Could not verify your permissions.',
    };
  }

  const missingPerms = permissions.filter(
    (perm) => !member.permissions.has(perm)
  );

  if (missingPerms.length > 0) {
    return {
      allowed: false,
      reason: `You need the following permissions: ${missingPerms.join(', ')}`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a user is either a bot owner OR has admin permissions
 */
export function checkBotOwnerOrAdmin(
  userId: string,
  member: GuildMember | null
): PermissionCheckResult {
  // Bot owners always pass
  if (isBotOwner(userId)) {
    return { allowed: true };
  }

  // Check for admin permissions
  if (member && member.permissions.has('Administrator')) {
    return { allowed: true };
  }

  return {
    allowed: false,
    reason: 'This command requires Administrator permissions or bot owner status.',
  };
}

/**
 * Require bot owner for an interaction - replies with error if not owner
 * Returns true if user is owner, false if not (and handles the error reply)
 */
export async function requireBotOwner(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction
): Promise<boolean> {
  const check = checkBotOwner(interaction.user.id);

  if (!check.allowed) {
    const replyOptions = {
      embeds: [errorEmbed('Permission Denied', check.reason!)],
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyOptions);
    } else {
      await interaction.reply(replyOptions);
    }
    return false;
  }

  return true;
}

/**
 * Require specific Discord permissions for an interaction
 * Returns true if user has permissions, false if not (and handles the error reply)
 */
export async function requirePermissions(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  permissions: PermissionResolvable[]
): Promise<boolean> {
  const member = interaction.member as GuildMember | null;
  const check = checkDiscordPermissions(member, permissions);

  if (!check.allowed) {
    const replyOptions = {
      embeds: [errorEmbed('Permission Denied', check.reason!)],
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyOptions);
    } else {
      await interaction.reply(replyOptions);
    }
    return false;
  }

  return true;
}

/**
 * Require bot owner OR admin permissions for an interaction
 * Returns true if user passes check, false if not (and handles the error reply)
 */
export async function requireBotOwnerOrAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction
): Promise<boolean> {
  const member = interaction.member as GuildMember | null;
  const check = checkBotOwnerOrAdmin(interaction.user.id, member);

  if (!check.allowed) {
    const replyOptions = {
      embeds: [errorEmbed('Permission Denied', check.reason!)],
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(replyOptions);
    } else {
      await interaction.reply(replyOptions);
    }
    return false;
  }

  return true;
}
