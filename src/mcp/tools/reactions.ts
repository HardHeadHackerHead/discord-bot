import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ChannelType } from 'discord.js';
import { smartFindTextChannel } from './utils.js';
import { getGuild } from '../discord-client.js';

/**
 * Reaction tools - get reaction data from messages
 */

export const reactionTools: Tool[] = [
  {
    name: 'get_reactions',
    description: 'Get all reactions on a message, including every user who reacted and their detailed member info (account creation date, server join date, roles, etc.). Channel name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'The channel name or ID (fuzzy matched)',
        },
        messageId: {
          type: 'string',
          description: 'The ID of the message to get reactions from',
        },
        emoji: {
          type: 'string',
          description: 'Optional: filter to a specific emoji (e.g., "👍" or custom emoji name). If not provided, returns all reactions.',
        },
      },
      required: ['channel', 'messageId'],
    },
  },
];

export async function executeReactionTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'get_reactions':
      return await getReactions(args);
    default:
      throw new Error(`Unknown reaction tool: ${name}`);
  }
}

async function getReactions(args: Record<string, unknown>): Promise<string> {
  const channelIdentifier = args['channel'] as string;
  const messageId = args['messageId'] as string;
  const emojiFilter = args['emoji'] as string | undefined;

  const channel = await smartFindTextChannel(channelIdentifier);
  const guild = await getGuild();

  const message = await channel.messages.fetch(messageId);
  if (!message) {
    throw new Error(`Message ${messageId} not found in #${channel.name}`);
  }

  const isVoice = channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;

  const reactions = [...message.reactions.cache.values()];

  // Filter by emoji if specified
  const filteredReactions = emojiFilter
    ? reactions.filter(r => {
        const name = r.emoji.name?.toLowerCase() ?? '';
        const filter = emojiFilter.toLowerCase();
        return name === filter || r.emoji.toString() === emojiFilter;
      })
    : reactions;

  if (filteredReactions.length === 0) {
    return JSON.stringify({
      channel: {
        id: channel.id,
        name: channel.name,
        type: isVoice ? 'voice' : 'text',
      },
      messageId: message.id,
      messageContent: message.content || '(no text content)',
      messageAuthor: {
        id: message.author.id,
        username: message.author.username,
      },
      totalReactions: 0,
      reactions: [],
    }, null, 2);
  }

  const reactionData = [];

  for (const reaction of filteredReactions) {
    // Fetch all users who reacted (handles pagination internally)
    const users = await reaction.users.fetch();

    const reactors = [];

    for (const user of users.values()) {
      // Try to get guild member info
      let memberInfo: Record<string, unknown> | null = null;
      try {
        const member = await guild.members.fetch(user.id);
        memberInfo = {
          displayName: member.displayName,
          nickname: member.nickname,
          joinedServer: member.joinedAt?.toISOString() ?? null,
          roles: member.roles.cache
            .filter(r => r.id !== guild.id)
            .sort((a, b) => b.position - a.position)
            .map(r => r.name),
          isTimedOut: member.isCommunicationDisabled(),
          premiumSince: member.premiumSince?.toISOString() ?? null,
          avatar: member.displayAvatarURL(),
        };
      } catch {
        // User may have left the server
        memberInfo = null;
      }

      reactors.push({
        id: user.id,
        username: user.username,
        isBot: user.bot,
        accountCreated: user.createdAt.toISOString(),
        ...(memberInfo
          ? { inServer: true, ...memberInfo }
          : { inServer: false }),
      });
    }

    reactionData.push({
      emoji: reaction.emoji.toString(),
      emojiName: reaction.emoji.name,
      isCustomEmoji: reaction.emoji.id !== null,
      count: reaction.count,
      reactors,
    });
  }

  return JSON.stringify({
    channel: {
      id: channel.id,
      name: channel.name,
      type: isVoice ? 'voice' : 'text',
    },
    messageId: message.id,
    messageContent: message.content || '(no text content)',
    messageAuthor: {
      id: message.author.id,
      username: message.author.username,
    },
    totalReactions: reactionData.reduce((sum, r) => sum + r.count, 0),
    reactions: reactionData,
  }, null, 2);
}
