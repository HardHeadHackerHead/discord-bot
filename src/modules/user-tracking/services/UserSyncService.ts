import { Client, Guild, GuildMember } from 'discord.js';
import { PrismaClient } from '@prisma/client';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('UserTracking:Sync');

/**
 * Service to sync guild members to the database
 */
export class UserSyncService {
  private client: Client;
  private prisma: PrismaClient;

  constructor(client: Client, prisma: PrismaClient) {
    this.client = client;
    this.prisma = prisma;
  }

  /**
   * Sync all members from all guilds the bot is in
   * Call this on bot startup to ensure all users are tracked
   */
  async syncAllGuilds(): Promise<void> {
    logger.info('Starting full guild sync...');

    const guilds = this.client.guilds.cache;
    let totalUsers = 0;
    let totalGuilds = 0;

    for (const [guildId, guild] of guilds) {
      try {
        const syncedCount = await this.syncGuild(guild);
        totalUsers += syncedCount;
        totalGuilds++;
      } catch (error) {
        logger.error(`Failed to sync guild ${guild.name} (${guildId}):`, error);
      }
    }

    logger.info(`Guild sync complete. Synced ${totalUsers} users across ${totalGuilds} guilds.`);
  }

  /**
   * Sync all members from a specific guild
   */
  async syncGuild(guild: Guild): Promise<number> {
    logger.debug(`Syncing guild: ${guild.name} (${guild.id})`);

    // First, ensure the guild exists in database
    await this.prisma.guild.upsert({
      where: { id: guild.id },
      update: {
        name: guild.name,
        iconHash: guild.icon,
        ownerId: guild.ownerId,
        isActive: true,
        leftAt: null,
      },
      create: {
        id: guild.id,
        name: guild.name,
        iconHash: guild.icon,
        ownerId: guild.ownerId,
      },
    });

    // Fetch all members (this may take time for large guilds)
    let members: GuildMember[];
    try {
      const fetchedMembers = await guild.members.fetch();
      members = Array.from(fetchedMembers.values());
    } catch (error) {
      logger.warn(`Could not fetch members for ${guild.name}: ${error}`);
      return 0;
    }

    logger.debug(`Fetched ${members.length} members from ${guild.name}`);

    // Batch upsert users and guild members
    let syncedCount = 0;

    // Process in batches to avoid overwhelming the database
    const BATCH_SIZE = 100;

    for (let i = 0; i < members.length; i += BATCH_SIZE) {
      const batch = members.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (member) => {
        try {
          await this.syncMember(member);
          syncedCount++;
        } catch (error) {
          // Log but don't fail the whole sync
          logger.debug(`Failed to sync member ${member.user.username}:`, error);
        }
      }));
    }

    logger.info(`Synced ${syncedCount}/${members.length} members from ${guild.name}`);
    return syncedCount;
  }

  /**
   * Sync a single guild member to the database
   */
  async syncMember(member: GuildMember): Promise<void> {
    const user = member.user;

    // Upsert user
    await this.prisma.user.upsert({
      where: { id: user.id },
      update: {
        username: user.username,
        discriminator: user.discriminator !== '0' ? user.discriminator : null,
        globalName: user.globalName,
        avatarHash: user.avatar,
        isBot: user.bot,
        updatedAt: new Date(),
      },
      create: {
        id: user.id,
        username: user.username,
        discriminator: user.discriminator !== '0' ? user.discriminator : null,
        globalName: user.globalName,
        avatarHash: user.avatar,
        isBot: user.bot,
      },
    });

    // Upsert guild member
    await this.prisma.guildMember.upsert({
      where: {
        guildId_userId: {
          guildId: member.guild.id,
          userId: user.id,
        },
      },
      update: {
        nickname: member.nickname,
        isActive: true,
        leftAt: null,
      },
      create: {
        guildId: member.guild.id,
        userId: user.id,
        nickname: member.nickname,
        joinedAt: member.joinedAt || new Date(),
      },
    });
  }
}
