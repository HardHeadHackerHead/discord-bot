import { Client, GatewayIntentBits, Partials, ChannelType } from 'discord.js';

let client: Client | null = null;
let guildId: string | null = null;

// Cached server data for fast lookups
export interface ServerCache {
  channels: Array<{ id: string; name: string; type: string; categoryId: string | null; categoryName: string | null }>;
  roles: Array<{ id: string; name: string; color: string; position: number }>;
  members: Array<{ id: string; username: string; displayName: string; nickname: string | null }>;
  lastUpdated: Date;
}

let serverCache: ServerCache | null = null;

/**
 * Initialize the Discord client for MCP server
 * Uses minimal intents needed for server management
 */
export async function initializeClient(): Promise<Client> {
  const token = process.env['DISCORD_TOKEN'];
  guildId = process.env['DISCORD_GUILD_ID'] || null;

  if (!token) {
    throw new Error('DISCORD_TOKEN environment variable is required');
  }

  if (!guildId) {
    throw new Error('DISCORD_GUILD_ID environment variable is required');
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildModeration,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessageReactions,
      GatewayIntentBits.GuildScheduledEvents,
      GatewayIntentBits.AutoModerationConfiguration,
      GatewayIntentBits.GuildWebhooks,
      GatewayIntentBits.GuildInvites,
    ],
    partials: [
      Partials.Message,
      Partials.Channel,
      Partials.GuildMember,
      Partials.Reaction,
    ],
  });

  await client.login(token);

  // Wait for client to be ready
  await new Promise<void>((resolve) => {
    if (client!.isReady()) {
      resolve();
    } else {
      client!.once('ready', () => resolve());
    }
  });

  return client;
}

/**
 * Get the Discord client instance
 */
export function getClient(): Client {
  if (!client) {
    throw new Error('Discord client not initialized. Call initializeClient() first.');
  }
  return client;
}

/**
 * Get the configured guild ID
 */
export function getGuildId(): string {
  if (!guildId) {
    throw new Error('Guild ID not configured. Set DISCORD_GUILD_ID environment variable.');
  }
  return guildId;
}

/**
 * Get the configured guild
 */
export async function getGuild() {
  const guild = getClient().guilds.cache.get(getGuildId());
  if (!guild) {
    throw new Error(`Bot is not in guild ${getGuildId()}`);
  }
  return guild;
}

/**
 * Destroy the Discord client connection
 */
export async function destroyClient(): Promise<void> {
  if (client) {
    client.destroy();
    client = null;
  }
  serverCache = null;
}

/**
 * Get channel type as string
 */
function getChannelTypeName(type: ChannelType): string {
  switch (type) {
    case ChannelType.GuildText: return 'text';
    case ChannelType.GuildVoice: return 'voice';
    case ChannelType.GuildCategory: return 'category';
    case ChannelType.GuildAnnouncement: return 'announcement';
    case ChannelType.GuildStageVoice: return 'stage';
    case ChannelType.GuildForum: return 'forum';
    default: return 'unknown';
  }
}

/**
 * Refresh the server cache with current data
 * Called on startup and can be called to refresh
 */
export async function refreshServerCache(): Promise<ServerCache> {
  const guild = await getGuild();

  // Fetch all members
  await guild.members.fetch();

  // Build channel cache
  const channels = [...guild.channels.cache.values()].map(c => {
    const parent = c.parentId ? guild.channels.cache.get(c.parentId) : null;
    return {
      id: c.id,
      name: c.name,
      type: getChannelTypeName(c.type),
      categoryId: c.parentId,
      categoryName: parent?.name ?? null,
    };
  });

  // Build role cache (exclude @everyone)
  const roles = [...guild.roles.cache.values()]
    .filter(r => r.id !== guild.id)
    .sort((a, b) => b.position - a.position)
    .map(r => ({
      id: r.id,
      name: r.name,
      color: r.hexColor,
      position: r.position,
    }));

  // Build member cache (exclude bots for simpler list)
  const members = [...guild.members.cache.values()]
    .filter(m => !m.user.bot)
    .map(m => ({
      id: m.id,
      username: m.user.username,
      displayName: m.displayName,
      nickname: m.nickname,
    }));

  serverCache = {
    channels,
    roles,
    members,
    lastUpdated: new Date(),
  };

  console.error(`Server cache refreshed: ${channels.length} channels, ${roles.length} roles, ${members.length} members`);

  return serverCache;
}

/**
 * Get the server cache (refreshes if not initialized)
 */
export async function getServerCache(): Promise<ServerCache> {
  if (!serverCache) {
    return refreshServerCache();
  }
  return serverCache;
}

/**
 * Get a summary of the server for context
 */
export async function getServerSummary(): Promise<string> {
  const cache = await getServerCache();
  const guild = await getGuild();

  const textChannels = cache.channels.filter(c => c.type === 'text' || c.type === 'announcement');
  const voiceChannels = cache.channels.filter(c => c.type === 'voice' || c.type === 'stage');

  let summary = `# Discord Server: ${guild.name}\n\n`;

  summary += `## Text Channels (${textChannels.length})\n`;
  for (const ch of textChannels) {
    const category = ch.categoryName ? ` (in ${ch.categoryName})` : '';
    summary += `- #${ch.name}${category}\n`;
  }

  summary += `\n## Voice Channels (${voiceChannels.length})\n`;
  for (const ch of voiceChannels) {
    const category = ch.categoryName ? ` (in ${ch.categoryName})` : '';
    summary += `- 🔊 ${ch.name}${category}\n`;
  }

  summary += `\n## Roles (${cache.roles.length})\n`;
  for (const role of cache.roles.slice(0, 20)) { // Limit to top 20 roles
    summary += `- @${role.name}\n`;
  }
  if (cache.roles.length > 20) {
    summary += `- ... and ${cache.roles.length - 20} more\n`;
  }

  summary += `\n## Members (${cache.members.length} non-bot members)\n`;
  summary += `Use list_members tool to see full member list.\n`;

  return summary;
}
