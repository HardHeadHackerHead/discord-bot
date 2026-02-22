import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getGuild } from '../discord-client.js';
import { smartFindChannel } from './utils.js';
import { AuditLogEvent, GuildVerificationLevel, GuildDefaultMessageNotifications, TextChannel } from 'discord.js';

/**
 * Server administration tools
 */

export const serverTools: Tool[] = [
  {
    name: 'edit_server',
    description: 'Modify server settings such as name, description, verification level, and default notification settings.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'New name for the server',
        },
        description: {
          type: 'string',
          description: 'New description for the server',
        },
        verificationLevel: {
          type: 'string',
          description: 'Verification level for the server',
          enum: ['none', 'low', 'medium', 'high', 'very_high'],
        },
        defaultNotifications: {
          type: 'string',
          description: 'Default notification setting for new members',
          enum: ['all', 'mentions'],
        },
        reason: {
          type: 'string',
          description: 'The reason for editing the server (shown in audit log)',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_invites',
    description: 'List all active invite links for the Discord server, including usage stats and expiration info.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_invite',
    description: 'Generate a new invite link for a specific channel. Channel name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'The channel name or ID to create the invite for (fuzzy matched)',
        },
        maxAge: {
          type: 'number',
          description: 'Maximum age of the invite in seconds (0 = never expires, default: 86400)',
        },
        maxUses: {
          type: 'number',
          description: 'Maximum number of uses (0 = unlimited, default: 0)',
        },
        temporary: {
          type: 'boolean',
          description: 'Whether the invite grants temporary membership (default: false)',
        },
        reason: {
          type: 'string',
          description: 'The reason for creating this invite (shown in audit log)',
        },
      },
      required: ['channel'],
    },
  },
  {
    name: 'delete_invite',
    description: 'Revoke an active invite link by its invite code.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The invite code to revoke',
        },
        reason: {
          type: 'string',
          description: 'The reason for deleting this invite (shown in audit log)',
        },
      },
      required: ['code'],
    },
  },
  {
    name: 'get_audit_log',
    description: 'Fetch recent audit log entries for the server. Optionally filter by action type or user.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Number of entries to fetch (default: 25, max: 100)',
        },
        actionType: {
          type: 'string',
          description: 'Filter by action type (e.g., "MemberKick", "MemberBan", "ChannelCreate", "MessageDelete")',
        },
        userId: {
          type: 'string',
          description: 'Filter by the user ID who performed the action',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_bans',
    description: 'View all banned users in the server along with their ban reasons.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

export async function executeServerTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'edit_server':
      return await editServer(args);
    case 'list_invites':
      return await listInvites();
    case 'create_invite':
      return await createInvite(args);
    case 'delete_invite':
      return await deleteInvite(args);
    case 'get_audit_log':
      return await getAuditLog(args);
    case 'list_bans':
      return await listBans();
    default:
      throw new Error(`Unknown server tool: ${name}`);
  }
}

async function editServer(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const reason = args['reason'] as string | undefined;

  const updates: Record<string, unknown> = {};

  if (args['name'] !== undefined) {
    updates['name'] = args['name'];
  }

  if (args['description'] !== undefined) {
    updates['description'] = args['description'];
  }

  if (args['verificationLevel'] !== undefined) {
    const verificationMap: Record<string, GuildVerificationLevel> = {
      'none': GuildVerificationLevel.None,
      'low': GuildVerificationLevel.Low,
      'medium': GuildVerificationLevel.Medium,
      'high': GuildVerificationLevel.High,
      'very_high': GuildVerificationLevel.VeryHigh,
    };
    const level = verificationMap[args['verificationLevel'] as string];
    if (level === undefined) {
      throw new Error(`Invalid verification level "${args['verificationLevel']}". Must be one of: none, low, medium, high, very_high`);
    }
    updates['verificationLevel'] = level;
  }

  if (args['defaultNotifications'] !== undefined) {
    const notificationMap: Record<string, GuildDefaultMessageNotifications> = {
      'all': GuildDefaultMessageNotifications.AllMessages,
      'mentions': GuildDefaultMessageNotifications.OnlyMentions,
    };
    const setting = notificationMap[args['defaultNotifications'] as string];
    if (setting === undefined) {
      throw new Error(`Invalid default notifications "${args['defaultNotifications']}". Must be one of: all, mentions`);
    }
    updates['defaultMessageNotifications'] = setting;
  }

  if (Object.keys(updates).length === 0) {
    throw new Error('No settings provided to update. Specify at least one of: name, description, verificationLevel, defaultNotifications');
  }

  await guild.edit({
    ...updates,
    reason: reason ?? 'Edited via MCP',
  } as any);

  return JSON.stringify({
    success: true,
    message: `Server settings updated successfully`,
    updated: Object.keys(updates),
  }, null, 2);
}

async function listInvites(): Promise<string> {
  const guild = await getGuild();
  const invites = await guild.invites.fetch();

  const inviteList = invites.map(invite => ({
    code: invite.code,
    url: `https://discord.gg/${invite.code}`,
    channel: {
      id: invite.channel?.id ?? null,
      name: invite.channel && 'name' in invite.channel ? invite.channel.name : null,
    },
    inviter: invite.inviter ? {
      id: invite.inviter.id,
      username: invite.inviter.username,
    } : null,
    uses: invite.uses,
    maxUses: invite.maxUses,
    maxAge: invite.maxAge,
    temporary: invite.temporary,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    createdAt: invite.createdAt?.toISOString() ?? null,
  }));

  return JSON.stringify({
    totalInvites: inviteList.length,
    invites: inviteList,
  }, null, 2);
}

async function createInvite(args: Record<string, unknown>): Promise<string> {
  const channelIdentifier = args['channel'] as string;
  const maxAge = args['maxAge'] as number | undefined;
  const maxUses = args['maxUses'] as number | undefined;
  const temporary = args['temporary'] as boolean | undefined;
  const reason = args['reason'] as string | undefined;

  const channel = await smartFindChannel(channelIdentifier);

  if (!('createInvite' in channel)) {
    throw new Error(`Cannot create invite for channel "${channel.name}" — unsupported channel type`);
  }

  const invite = await (channel as any).createInvite({
    maxAge: maxAge ?? 86400,
    maxUses: maxUses ?? 0,
    temporary: temporary ?? false,
    reason: reason ?? 'Created via MCP',
  });

  return JSON.stringify({
    success: true,
    message: `Invite created successfully`,
    invite: {
      code: invite.code,
      url: `https://discord.gg/${invite.code}`,
      channel: {
        id: channel.id,
        name: channel.name,
      },
      maxAge: invite.maxAge,
      maxUses: invite.maxUses,
      temporary: invite.temporary,
      expiresAt: invite.expiresAt?.toISOString() ?? null,
    },
  }, null, 2);
}

async function deleteInvite(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const code = args['code'] as string;
  const reason = args['reason'] as string | undefined;

  const invites = await guild.invites.fetch();
  const invite = invites.find(i => i.code === code);

  if (!invite) {
    throw new Error(`Invite with code "${code}" not found`);
  }

  await invite.delete(reason ?? 'Deleted via MCP');

  return JSON.stringify({
    success: true,
    message: `Invite "${code}" has been revoked`,
  }, null, 2);
}

async function getAuditLog(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const limit = Math.min(args['limit'] as number || 25, 100);
  const actionType = args['actionType'] as string | undefined;
  const userId = args['userId'] as string | undefined;

  const fetchOptions: {
    limit: number;
    type?: AuditLogEvent;
    user?: string;
  } = { limit };

  if (actionType) {
    const eventType = AuditLogEvent[actionType as keyof typeof AuditLogEvent];
    if (eventType === undefined) {
      throw new Error(`Invalid action type "${actionType}". Examples: MemberKick, MemberBanAdd, ChannelCreate, MessageDelete`);
    }
    fetchOptions.type = eventType;
  }

  if (userId) {
    fetchOptions.user = userId;
  }

  const auditLogs = await guild.fetchAuditLogs(fetchOptions);

  const entries = auditLogs.entries.map(entry => ({
    actionType: AuditLogEvent[entry.action] ?? String(entry.action),
    executor: entry.executor ? {
      id: entry.executor.id,
      username: entry.executor.username,
    } : null,
    target: entry.target ? {
      id: 'id' in (entry.target as any) ? (entry.target as any).id : null,
      type: entry.targetType,
    } : null,
    reason: entry.reason ?? null,
    changes: entry.changes.length > 0 ? entry.changes.map(c => ({
      key: c.key,
      old: c.old ?? null,
      new: c.new ?? null,
    })) : null,
    createdAt: entry.createdAt.toISOString(),
  }));

  return JSON.stringify({
    totalEntries: entries.length,
    entries,
  }, null, 2);
}

async function listBans(): Promise<string> {
  const guild = await getGuild();
  const bans = await guild.bans.fetch();

  const banList = bans.map(ban => ({
    user: {
      id: ban.user.id,
      username: ban.user.username,
    },
    reason: ban.reason ?? null,
  }));

  return JSON.stringify({
    totalBans: banList.length,
    bans: banList,
  }, null, 2);
}
