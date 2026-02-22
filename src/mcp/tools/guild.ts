import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getClient, getGuild, getGuildId } from '../discord-client.js';

/**
 * Guild information tools
 */

export const guildTools: Tool[] = [
  {
    name: 'list_guilds',
    description: 'List all Discord servers (guilds) the bot is a member of. Returns server names and IDs.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_guild_info',
    description: 'Get detailed information about the configured Discord server, including member count, channels, roles, and server settings.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

export async function executeGuildTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_guilds':
      return await listGuilds();
    case 'get_guild_info':
      return await getGuildInfo();
    default:
      throw new Error(`Unknown guild tool: ${name}`);
  }
}

async function listGuilds(): Promise<string> {
  const client = getClient();
  const guilds = client.guilds.cache;
  const configuredGuildId = getGuildId();

  const guildList = guilds.map(guild => ({
    id: guild.id,
    name: guild.name,
    memberCount: guild.memberCount,
    isConfigured: guild.id === configuredGuildId,
  }));

  return JSON.stringify({
    totalGuilds: guildList.length,
    configuredGuildId,
    guilds: guildList,
  }, null, 2);
}

async function getGuildInfo(): Promise<string> {
  const guild = await getGuild();

  // Fetch additional guild data
  await guild.members.fetch();

  const info = {
    id: guild.id,
    name: guild.name,
    description: guild.description,
    icon: guild.iconURL(),
    banner: guild.bannerURL(),
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    createdAt: guild.createdAt.toISOString(),
    features: guild.features,
    verificationLevel: guild.verificationLevel,
    premiumTier: guild.premiumTier,
    premiumSubscriptionCount: guild.premiumSubscriptionCount,
    channels: {
      total: guild.channels.cache.size,
      text: guild.channels.cache.filter(c => c.isTextBased() && !c.isVoiceBased()).size,
      voice: guild.channels.cache.filter(c => c.isVoiceBased()).size,
      categories: guild.channels.cache.filter(c => c.type === 4).size,
    },
    roles: {
      total: guild.roles.cache.size,
      list: guild.roles.cache
        .sort((a, b) => b.position - a.position)
        .map(r => ({ id: r.id, name: r.name, color: r.hexColor, position: r.position })),
    },
    emojis: {
      total: guild.emojis.cache.size,
      static: guild.emojis.cache.filter(e => !e.animated).size,
      animated: guild.emojis.cache.filter(e => e.animated === true).size,
    },
  };

  return JSON.stringify(info, null, 2);
}
