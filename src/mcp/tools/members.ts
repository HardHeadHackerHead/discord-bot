import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getGuild } from '../discord-client.js';
import { smartFindMember, smartFindRole, smartFindChannel } from './utils.js';
import { ChannelType, VoiceChannel, StageChannel } from 'discord.js';

/**
 * Member management tools
 */

export const memberTools: Tool[] = [
  {
    name: 'list_members',
    description: 'List members in the Discord server with optional filters. Returns usernames, display names, roles, and join dates. Role filter is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'number',
          description: 'Maximum number of members to return (default: 50, max: 1000)',
        },
        role: {
          type: 'string',
          description: 'Filter members by role name or ID (fuzzy matched)',
        },
        search: {
          type: 'string',
          description: 'Search members by username or display name',
        },
      },
      required: [],
    },
  },
  {
    name: 'get_member',
    description: 'Get detailed information about a specific member including their roles, join date, and status. Member name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID (fuzzy matched)',
        },
      },
      required: ['member'],
    },
  },
  {
    name: 'kick_member',
    description: 'Kick a member from the Discord server. They can rejoin with a new invite. Member name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID to kick (fuzzy matched)',
        },
        reason: {
          type: 'string',
          description: 'The reason for kicking this member (shown in audit log)',
        },
      },
      required: ['member'],
    },
  },
  {
    name: 'ban_member',
    description: 'Ban a member from the Discord server. They cannot rejoin until unbanned. Member name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID to ban (fuzzy matched)',
        },
        reason: {
          type: 'string',
          description: 'The reason for banning this member (shown in audit log)',
        },
        deleteMessageDays: {
          type: 'number',
          description: 'Number of days of messages to delete (0-7, default: 0)',
        },
      },
      required: ['member'],
    },
  },
  {
    name: 'unban_member',
    description: 'Remove a ban from a user, allowing them to rejoin the server.',
    inputSchema: {
      type: 'object',
      properties: {
        user: {
          type: 'string',
          description: 'The user\'s username or user ID to unban',
        },
        reason: {
          type: 'string',
          description: 'The reason for unbanning this user (shown in audit log)',
        },
      },
      required: ['user'],
    },
  },
  {
    name: 'timeout_member',
    description: 'Apply a timeout to a member, temporarily preventing them from sending messages or joining voice channels. Member name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID to timeout (fuzzy matched)',
        },
        duration: {
          type: 'string',
          description: 'Duration of the timeout (e.g., "10m" for 10 minutes, "1h" for 1 hour, "1d" for 1 day). Use "remove" to remove timeout.',
        },
        reason: {
          type: 'string',
          description: 'The reason for the timeout (shown in audit log)',
        },
      },
      required: ['member', 'duration'],
    },
  },
  {
    name: 'move_to_voice',
    description: 'Move a member from their current voice channel to a different voice channel. The member must already be in a voice channel.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID (fuzzy matched)',
        },
        channel: {
          type: 'string',
          description: 'The voice channel name or ID to move them to (fuzzy matched)',
        },
      },
      required: ['member', 'channel'],
    },
  },
  {
    name: 'disconnect_from_voice',
    description: 'Disconnect a member from their current voice channel.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID (fuzzy matched)',
        },
        reason: {
          type: 'string',
          description: 'The reason for disconnecting (shown in audit log)',
        },
      },
      required: ['member'],
    },
  },
  {
    name: 'set_nickname',
    description: 'Change a member\'s nickname in the server. Member name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'The member\'s username, display name, or user ID (fuzzy matched)',
        },
        nickname: {
          type: 'string',
          description: 'The new nickname (use empty string or "reset" to remove nickname)',
        },
        reason: {
          type: 'string',
          description: 'The reason for changing the nickname (shown in audit log)',
        },
      },
      required: ['member', 'nickname'],
    },
  },
];

export async function executeMemberTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_members':
      return await listMembers(args);
    case 'get_member':
      return await getMember(args);
    case 'kick_member':
      return await kickMember(args);
    case 'ban_member':
      return await banMember(args);
    case 'unban_member':
      return await unbanMember(args);
    case 'timeout_member':
      return await timeoutMember(args);
    case 'move_to_voice':
      return await moveToVoice(args);
    case 'disconnect_from_voice':
      return await disconnectFromVoice(args);
    case 'set_nickname':
      return await setNickname(args);
    default:
      throw new Error(`Unknown member tool: ${name}`);
  }
}

async function listMembers(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const limit = Math.min(args['limit'] as number || 50, 1000);
  const roleFilter = args['role'] as string | undefined;
  const searchQuery = args['search'] as string | undefined;

  await guild.members.fetch();

  let members = [...guild.members.cache.values()];

  // Filter by role using smart matching
  if (roleFilter) {
    try {
      const role = await smartFindRole(roleFilter);
      members = members.filter(m => m.roles.cache.has(role.id));
    } catch {
      // If role not found, return empty list
      members = [];
    }
  }

  // Filter by search query
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    members = members.filter(
      m =>
        m.user.username.toLowerCase().includes(query) ||
        m.displayName.toLowerCase().includes(query)
    );
  }

  // Sort by join date and limit
  members = members
    .sort((a, b) => (a.joinedTimestamp ?? 0) - (b.joinedTimestamp ?? 0))
    .slice(0, limit);

  const memberList = members.map(m => ({
    id: m.id,
    username: m.user.username,
    displayName: m.displayName,
    isBot: m.user.bot,
    joinedAt: m.joinedAt?.toISOString() ?? null,
    roles: m.roles.cache
      .filter(r => r.id !== guild.id)
      .map(r => r.name),
    isTimedOut: m.isCommunicationDisabled(),
  }));

  return JSON.stringify({
    totalShown: memberList.length,
    totalInServer: guild.memberCount,
    members: memberList,
  }, null, 2);
}

async function getMember(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const memberIdentifier = args['member'] as string;

  const member = await smartFindMember(memberIdentifier);

  const info = {
    id: member.id,
    username: member.user.username,
    displayName: member.displayName,
    nickname: member.nickname,
    avatar: member.displayAvatarURL(),
    isBot: member.user.bot,
    createdAt: member.user.createdAt.toISOString(),
    joinedAt: member.joinedAt?.toISOString() ?? null,
    roles: member.roles.cache
      .filter(r => r.id !== guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
    permissions: member.permissions.toArray(),
    isOwner: member.id === guild.ownerId,
    isTimedOut: member.isCommunicationDisabled(),
    timeoutUntil: member.communicationDisabledUntil?.toISOString() ?? null,
    premiumSince: member.premiumSince?.toISOString() ?? null,
  };

  return JSON.stringify(info, null, 2);
}

async function kickMember(args: Record<string, unknown>): Promise<string> {
  const memberIdentifier = args['member'] as string;
  const reason = args['reason'] as string | undefined;

  const member = await smartFindMember(memberIdentifier);

  if (!member.kickable) {
    throw new Error(`Cannot kick "${member.displayName}" - insufficient permissions or they have higher role`);
  }

  const memberName = member.displayName;
  await member.kick(reason ?? 'Kicked via MCP');

  return JSON.stringify({
    success: true,
    message: `Member "${memberName}" has been kicked from the server`,
    reason: reason ?? 'Kicked via MCP',
  }, null, 2);
}

async function banMember(args: Record<string, unknown>): Promise<string> {
  const memberIdentifier = args['member'] as string;
  const reason = args['reason'] as string | undefined;
  const deleteMessageDays = args['deleteMessageDays'] as number || 0;

  const member = await smartFindMember(memberIdentifier);

  if (!member.bannable) {
    throw new Error(`Cannot ban "${member.displayName}" - insufficient permissions or they have higher role`);
  }

  const memberName = member.displayName;
  await member.ban({
    reason: reason ?? 'Banned via MCP',
    deleteMessageSeconds: deleteMessageDays * 24 * 60 * 60,
  });

  return JSON.stringify({
    success: true,
    message: `Member "${memberName}" has been banned from the server`,
    reason: reason ?? 'Banned via MCP',
    deletedMessageDays: deleteMessageDays,
  }, null, 2);
}

async function unbanMember(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const userIdentifier = args['user'] as string;
  const reason = args['reason'] as string | undefined;

  // Fetch bans
  const bans = await guild.bans.fetch();

  const ban = bans.find(
    b =>
      b.user.id === userIdentifier ||
      b.user.username.toLowerCase() === userIdentifier.toLowerCase() ||
      b.user.tag.toLowerCase() === userIdentifier.toLowerCase()
  );

  if (!ban) {
    throw new Error(`No ban found for user "${userIdentifier}"`);
  }

  await guild.members.unban(ban.user, reason ?? 'Unbanned via MCP');

  return JSON.stringify({
    success: true,
    message: `User "${ban.user.username}" has been unbanned`,
    user: {
      id: ban.user.id,
      username: ban.user.username,
    },
    reason: reason ?? 'Unbanned via MCP',
  }, null, 2);
}

function parseDuration(duration: string): number | null {
  if (duration.toLowerCase() === 'remove') {
    return null;
  }

  const match = duration.match(/^(\d+)(s|m|h|d|w)$/i);
  if (!match) {
    throw new Error('Invalid duration format. Use format like "10m", "1h", "1d", "1w" or "remove"');
  }

  const value = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();

  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };

  return value * multipliers[unit]!;
}

async function timeoutMember(args: Record<string, unknown>): Promise<string> {
  const memberIdentifier = args['member'] as string;
  const duration = args['duration'] as string;
  const reason = args['reason'] as string | undefined;

  const member = await smartFindMember(memberIdentifier);

  if (!member.moderatable) {
    throw new Error(`Cannot timeout "${member.displayName}" - insufficient permissions or they have higher role`);
  }

  const durationMs = parseDuration(duration);

  if (durationMs === null) {
    // Remove timeout
    await member.timeout(null, reason ?? 'Timeout removed via MCP');
    return JSON.stringify({
      success: true,
      message: `Timeout removed from "${member.displayName}"`,
    }, null, 2);
  }

  // Max timeout is 28 days
  const maxTimeout = 28 * 24 * 60 * 60 * 1000;
  if (durationMs > maxTimeout) {
    throw new Error('Timeout duration cannot exceed 28 days');
  }

  await member.timeout(durationMs, reason ?? 'Timed out via MCP');

  const timeoutUntil = new Date(Date.now() + durationMs);

  return JSON.stringify({
    success: true,
    message: `Member "${member.displayName}" has been timed out`,
    duration,
    timeoutUntil: timeoutUntil.toISOString(),
    reason: reason ?? 'Timed out via MCP',
  }, null, 2);
}

async function setNickname(args: Record<string, unknown>): Promise<string> {
  const memberIdentifier = args['member'] as string;
  let nickname = args['nickname'] as string;
  const reason = args['reason'] as string | undefined;

  const member = await smartFindMember(memberIdentifier);

  if (!member.manageable) {
    throw new Error(`Cannot change nickname for "${member.displayName}" - insufficient permissions or they have higher role`);
  }

  // Handle reset
  const shouldReset = nickname === 'reset' || nickname === '';

  const oldNickname = member.nickname;
  await member.setNickname(shouldReset ? null : nickname, reason ?? 'Nickname changed via MCP');

  return JSON.stringify({
    success: true,
    message: shouldReset
      ? `Nickname reset for "${member.user.username}"`
      : `Nickname for "${member.user.username}" changed to "${nickname}"`,
    oldNickname,
    newNickname: shouldReset ? null : nickname,
  }, null, 2);
}

async function moveToVoice(args: Record<string, unknown>): Promise<string> {
  const memberIdentifier = args['member'] as string;
  const channelIdentifier = args['channel'] as string;

  const member = await smartFindMember(memberIdentifier);
  const channel = await smartFindChannel(channelIdentifier);

  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    throw new Error(`"${channel.name}" is not a voice channel`);
  }

  if (!member.voice.channel) {
    throw new Error(`"${member.displayName}" is not currently in a voice channel`);
  }

  const oldChannel = member.voice.channel.name;
  await member.voice.setChannel(channel as VoiceChannel | StageChannel);

  return JSON.stringify({
    success: true,
    message: `Moved "${member.displayName}" from "${oldChannel}" to "${channel.name}"`,
    member: { id: member.id, displayName: member.displayName },
    from: oldChannel,
    to: channel.name,
  }, null, 2);
}

async function disconnectFromVoice(args: Record<string, unknown>): Promise<string> {
  const memberIdentifier = args['member'] as string;
  const reason = args['reason'] as string | undefined;

  const member = await smartFindMember(memberIdentifier);

  if (!member.voice.channel) {
    throw new Error(`"${member.displayName}" is not currently in a voice channel`);
  }

  const channelName = member.voice.channel.name;
  await member.voice.disconnect(reason ?? 'Disconnected via MCP');

  return JSON.stringify({
    success: true,
    message: `Disconnected "${member.displayName}" from "${channelName}"`,
    member: { id: member.id, displayName: member.displayName },
    disconnectedFrom: channelName,
    reason: reason ?? 'Disconnected via MCP',
  }, null, 2);
}
