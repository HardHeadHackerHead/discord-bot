import {
  Guild,
  GuildMember,
  VoiceChannel,
  ChannelType,
  PermissionFlagsBits,
  VoiceBasedChannel,
  OverwriteResolvable,
} from 'discord.js';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { getChannelRateLimitManager } from './ChannelRateLimitManager.js';

const logger = new Logger('DynamicLab:Service');

/** Flask emoji prefix for lab owners */
export const LAB_OWNER_EMOJI = '🧪';

/** Prefix format: colon before flask for alphabetical sorting to top */
export const LAB_OWNER_PREFIX = `:${LAB_OWNER_EMOJI}`;

/**
 * Lab creator channel configuration
 */
export interface LabCreator {
  id: string;
  guild_id: string;
  channel_id: string;
  category_id: string | null;
  default_name: string;
  default_user_limit: number;
  default_bitrate: number;
  is_active: boolean;
}

/**
 * Active lab channel
 */
export interface LabChannel {
  id: string;
  channel_id: string;
  guild_id: string;
  creator_id: string;
  owner_id: string;
  name: string;
  is_locked: boolean;
  control_message_id: string | null;
}

/**
 * User lab settings/preferences
 */
export interface LabUserSettings {
  id: string;
  user_id: string;
  guild_id: string;
  lab_name: string | null;
  user_limit: number;
  bitrate: number;
  is_locked: boolean;
}

/**
 * Service for managing dynamic lab channels
 */
export class LabService {
  readonly db: DatabaseService;

  constructor(db: DatabaseService) {
    this.db = db;
  }

  // ==================== Creator Channel Management ====================

  /**
   * Get a lab creator by channel ID
   */
  async getCreatorByChannel(channelId: string): Promise<LabCreator | null> {
    const rows = await this.db.query<(LabCreator & RowDataPacket)[]>(
      'SELECT * FROM lab_creators WHERE channel_id = ? AND is_active = TRUE',
      [channelId]
    );
    return rows[0] || null;
  }

  /**
   * Get all lab creators for a guild
   */
  async getCreatorsByGuild(guildId: string): Promise<LabCreator[]> {
    return this.db.query<(LabCreator & RowDataPacket)[]>(
      'SELECT * FROM lab_creators WHERE guild_id = ? AND is_active = TRUE',
      [guildId]
    );
  }

  /**
   * Create a new lab creator channel
   */
  async createCreator(
    guildId: string,
    channelId: string,
    categoryId: string | null,
    options?: {
      defaultName?: string;
      defaultUserLimit?: number;
      defaultBitrate?: number;
    }
  ): Promise<LabCreator> {
    const id = uuidv4();
    const defaultName = options?.defaultName || "@user's Lab";
    const defaultUserLimit = options?.defaultUserLimit || 0;
    const defaultBitrate = options?.defaultBitrate || 64000;

    await this.db.execute(
      `INSERT INTO lab_creators (id, guild_id, channel_id, category_id, default_name, default_user_limit, default_bitrate)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (channel_id) DO UPDATE SET is_active = TRUE, category_id = EXCLUDED.category_id, default_name = EXCLUDED.default_name, default_user_limit = EXCLUDED.default_user_limit, default_bitrate = EXCLUDED.default_bitrate`,
      [id, guildId, channelId, categoryId, defaultName, defaultUserLimit, defaultBitrate]
    );

    return {
      id,
      guild_id: guildId,
      channel_id: channelId,
      category_id: categoryId,
      default_name: defaultName,
      default_user_limit: defaultUserLimit,
      default_bitrate: defaultBitrate,
      is_active: true,
    };
  }

  /**
   * Remove a lab creator
   */
  async removeCreator(channelId: string): Promise<void> {
    await this.db.execute(
      'UPDATE lab_creators SET is_active = FALSE WHERE channel_id = ?',
      [channelId]
    );
  }

  // ==================== Lab Channel Management ====================

  /**
   * Get an active lab by channel ID
   */
  async getLabByChannel(channelId: string): Promise<LabChannel | null> {
    const rows = await this.db.query<(LabChannel & RowDataPacket)[]>(
      'SELECT * FROM lab_channels WHERE channel_id = ?',
      [channelId]
    );
    return rows[0] || null;
  }

  /**
   * Get a user's active lab in a guild
   */
  async getUserLab(userId: string, guildId: string): Promise<LabChannel | null> {
    const rows = await this.db.query<(LabChannel & RowDataPacket)[]>(
      'SELECT * FROM lab_channels WHERE owner_id = ? AND guild_id = ?',
      [userId, guildId]
    );
    return rows[0] || null;
  }

  /**
   * Create a new lab channel for a user
   */
  async createLab(
    guild: Guild,
    member: GuildMember,
    creator: LabCreator
  ): Promise<{ channel: VoiceChannel; lab: LabChannel } | null> {
    // Get user's saved settings
    const settings = await this.getUserSettings(member.id, guild.id);

    // Determine lab name
    let labName = settings?.lab_name || creator.default_name;
    labName = labName.replace('@user', member.displayName);

    // Determine other settings
    const userLimit = settings?.user_limit ?? creator.default_user_limit;
    const bitrate = settings?.bitrate ?? creator.default_bitrate;
    const isLocked = settings?.is_locked ?? false;

    try {
      // Create the voice channel
      const channel = await guild.channels.create({
        name: labName,
        type: ChannelType.GuildVoice,
        parent: creator.category_id || undefined,
        userLimit: userLimit,
        bitrate: Math.min(bitrate, guild.maximumBitrate),
        permissionOverwrites: [
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.MuteMembers,
              PermissionFlagsBits.DeafenMembers,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
          // If locked, deny connect for everyone else
          ...(isLocked ? [{
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect],
          }] : []),
        ],
      });

      // Store in database
      const labId = uuidv4();
      await this.db.execute(
        `INSERT INTO lab_channels (id, channel_id, guild_id, creator_id, owner_id, name, is_locked)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [labId, channel.id, guild.id, creator.id, member.id, labName, isLocked]
      );

      const lab: LabChannel = {
        id: labId,
        channel_id: channel.id,
        guild_id: guild.id,
        creator_id: creator.id,
        owner_id: member.id,
        name: labName,
        is_locked: isLocked,
        control_message_id: null,
      };

      logger.info(`Created lab "${labName}" for ${member.user.username} in ${guild.name}`);

      return { channel, lab };

    } catch (error) {
      logger.error(`Failed to create lab for ${member.user.username}:`, error);
      return null;
    }
  }

  /**
   * Delete a lab channel
   */
  async deleteLab(channelId: string, guild: Guild): Promise<void> {
    // Get the lab info first to find the owner
    const lab = await this.getLabByChannel(channelId);

    // Clean up rate limit tracking for this channel
    const rateLimitManager = getChannelRateLimitManager();
    rateLimitManager.removeChannel(channelId);

    // Delete from database
    await this.db.execute('DELETE FROM lab_permitted_users WHERE lab_channel_id IN (SELECT id FROM lab_channels WHERE channel_id = ?)', [channelId]);
    await this.db.execute('DELETE FROM lab_channels WHERE channel_id = ?', [channelId]);

    // Remove flask prefix from owner's nickname
    if (lab) {
      try {
        const owner = await guild.members.fetch(lab.owner_id).catch(() => null);
        if (owner) {
          await this.removeFlaskFromNickname(owner);
        }
      } catch (error) {
        logger.debug('Could not remove flask from owner nickname:', error);
      }
    }

    // Delete the Discord channel
    try {
      const channel = guild.channels.cache.get(channelId);
      if (channel) {
        await channel.delete('Lab empty - auto cleanup');
        logger.info(`Deleted empty lab channel in ${guild.name}`);
      }
    } catch (error) {
      logger.error('Failed to delete lab channel:', error);
    }
  }

  /**
   * Update lab's control message ID
   */
  async setControlMessage(labId: string, messageId: string): Promise<void> {
    await this.db.execute(
      'UPDATE lab_channels SET control_message_id = ? WHERE id = ?',
      [messageId, labId]
    );
  }

  /**
   * Transfer lab ownership to a new user (database only)
   */
  async transferOwnership(labId: string, newOwnerId: string): Promise<boolean> {
    try {
      const result = await this.db.execute(
        'UPDATE lab_channels SET owner_id = ? WHERE id = ?',
        [newOwnerId, labId]
      );
      logger.info(`Transferred lab ${labId} ownership to user ${newOwnerId}`);
      return result.affectedRows > 0;
    } catch (error) {
      logger.error('Failed to transfer lab ownership:', error);
      return false;
    }
  }

  /**
   * Apply a new owner's settings to a lab channel after ownership transfer
   * This includes: name, lock state, permit list, and user limit
   */
  async applyNewOwnerSettings(
    lab: LabChannel,
    channel: VoiceChannel,
    newOwner: GuildMember,
    creator: LabCreator
  ): Promise<{ name: string; isLocked: boolean }> {
    const guild = channel.guild;

    // Get the new owner's saved settings
    const settings = await this.getUserSettings(newOwner.id, guild.id);

    // Determine new lab name
    let newLabName = settings?.lab_name || creator.default_name;
    newLabName = newLabName.replace('@user', newOwner.displayName);

    // Determine other settings
    const newUserLimit = settings?.user_limit ?? creator.default_user_limit;
    const newIsLocked = settings?.is_locked ?? false;

    // Build permission overwrites
    const permissionOverwrites: OverwriteResolvable[] = [
      {
        id: newOwner.id,
        allow: [
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.MoveMembers,
          PermissionFlagsBits.MuteMembers,
          PermissionFlagsBits.DeafenMembers,
          PermissionFlagsBits.Connect,
          PermissionFlagsBits.Speak,
        ],
      },
    ];

    // If locked, deny connect for everyone else
    if (newIsLocked) {
      permissionOverwrites.push({
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.Connect],
      });

      // Apply the new owner's permit list
      const permitList = await this.getUserPermitList(newOwner.id, guild.id);
      for (const userId of permitList) {
        permissionOverwrites.push({
          id: userId,
          allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
        });
      }
    }

    // Allow current members in the channel to stay (add their permissions)
    for (const [memberId, member] of channel.members) {
      if (memberId !== newOwner.id && !member.user.bot) {
        // Check if they already have an override in our list
        const hasOverride = permissionOverwrites.some(po => po.id === memberId);
        if (!hasOverride) {
          permissionOverwrites.push({
            id: memberId,
            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
          });
        }
      }
    }

    // Update the Discord channel - handle name change with rate limiting
    const rateLimitManager = getChannelRateLimitManager();
    const needsNameChange = channel.name !== newLabName;

    try {
      if (needsNameChange && !rateLimitManager.canChangeName(channel.id)) {
        // Name change is rate limited - update everything except name now
        await channel.edit({
          userLimit: newUserLimit,
          permissionOverwrites,
        });

        // Queue the name change for later
        rateLimitManager.queueNameChange(channel.id, newLabName, async () => {
          try {
            const freshChannel = await channel.guild.channels.fetch(channel.id) as VoiceChannel | null;
            if (freshChannel && freshChannel.type === ChannelType.GuildVoice) {
              await freshChannel.setName(newLabName, 'Lab name update (queued)');
              rateLimitManager.recordNameChange(channel.id);
              logger.info(`Applied queued name change for lab to "${newLabName}"`);
            }
          } catch (error) {
            logger.error('Failed to apply queued name change:', error);
          }
        });

        logger.info(`Channel settings applied, but name change queued due to rate limit`);
      } else {
        // Can update everything including name
        await channel.edit({
          name: newLabName,
          userLimit: newUserLimit,
          permissionOverwrites,
        });

        if (needsNameChange) {
          rateLimitManager.recordNameChange(channel.id);
        }
      }
    } catch (error) {
      logger.error('Failed to update channel settings for new owner:', error);
    }

    // Update the database (always update immediately, even if Discord change is queued)
    await this.db.execute(
      'UPDATE lab_channels SET name = ?, is_locked = ? WHERE id = ?',
      [newLabName, newIsLocked, lab.id]
    );

    logger.info(`Applied ${newOwner.user.username}'s settings to lab: name="${newLabName}", locked=${newIsLocked}`);

    return { name: newLabName, isLocked: newIsLocked };
  }

  /**
   * Get the creator for a lab
   */
  async getCreatorForLab(labId: string): Promise<LabCreator | null> {
    const rows = await this.db.query<(LabCreator & RowDataPacket)[]>(
      `SELECT c.* FROM lab_creators c
       INNER JOIN lab_channels l ON l.creator_id = c.id
       WHERE l.id = ?`,
      [labId]
    );
    return rows[0] || null;
  }

  // ==================== Lab Settings ====================

  /**
   * Get user's lab settings
   */
  async getUserSettings(userId: string, guildId: string): Promise<LabUserSettings | null> {
    const rows = await this.db.query<(LabUserSettings & RowDataPacket)[]>(
      'SELECT * FROM lab_user_settings WHERE user_id = ? AND guild_id = ?',
      [userId, guildId]
    );
    return rows[0] || null;
  }

  /**
   * Update user's lab settings
   */
  async updateUserSettings(
    userId: string,
    guildId: string,
    settings: Partial<Pick<LabUserSettings, 'lab_name' | 'user_limit' | 'bitrate' | 'is_locked'>>
  ): Promise<void> {
    const id = uuidv4();

    // Build SET clause dynamically
    const updates: string[] = [];
    const values: unknown[] = [];

    if (settings.lab_name !== undefined) {
      updates.push('lab_name = ?');
      values.push(settings.lab_name);
    }
    if (settings.user_limit !== undefined) {
      updates.push('user_limit = ?');
      values.push(settings.user_limit);
    }
    if (settings.bitrate !== undefined) {
      updates.push('bitrate = ?');
      values.push(settings.bitrate);
    }
    if (settings.is_locked !== undefined) {
      updates.push('is_locked = ?');
      values.push(settings.is_locked);
    }

    if (updates.length === 0) return;

    await this.db.execute(
      `INSERT INTO lab_user_settings (id, user_id, guild_id, ${Object.keys(settings).join(', ')})
       VALUES (?, ?, ?, ${values.map(() => '?').join(', ')})
       ON CONFLICT (user_id, guild_id) DO UPDATE SET ${Object.keys(settings).map(k => `${k} = EXCLUDED.${k}`).join(', ')}`,
      [id, userId, guildId, ...values]
    );
  }

  /**
   * Update a live lab channel
   * Returns info about whether the name change was queued due to rate limiting
   */
  async updateLabChannel(
    lab: LabChannel,
    channel: VoiceBasedChannel,
    updates: {
      name?: string;
      userLimit?: number;
      isLocked?: boolean;
    }
  ): Promise<{ nameChangeQueued: boolean }> {
    const guild = channel.guild;
    const rateLimitManager = getChannelRateLimitManager();

    // Build channel updates (excluding name initially)
    const channelUpdates: Parameters<typeof channel.edit>[0] = {};
    let nameChangeQueued = false;

    if (updates.userLimit !== undefined) {
      channelUpdates.userLimit = updates.userLimit;
    }

    if (updates.isLocked !== undefined) {
      if (updates.isLocked) {
        // Lock: deny connect for everyone
        channelUpdates.permissionOverwrites = [
          {
            id: lab.owner_id,
            allow: [
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.MuteMembers,
              PermissionFlagsBits.DeafenMembers,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
          {
            id: guild.roles.everyone.id,
            deny: [PermissionFlagsBits.Connect],
          },
        ];
      } else {
        // Unlock: allow connect for everyone
        channelUpdates.permissionOverwrites = [
          {
            id: lab.owner_id,
            allow: [
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.MuteMembers,
              PermissionFlagsBits.DeafenMembers,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
            ],
          },
        ];
      }
    }

    // Handle name change with rate limiting
    const needsNameChange = updates.name !== undefined && channel.name !== updates.name;

    if (needsNameChange) {
      if (rateLimitManager.canChangeName(channel.id)) {
        // Can change name now
        channelUpdates.name = updates.name;
      } else {
        // Queue the name change for later
        const newName = updates.name!;
        rateLimitManager.queueNameChange(channel.id, newName, async () => {
          try {
            const freshChannel = await guild.channels.fetch(channel.id) as VoiceChannel | null;
            if (freshChannel && freshChannel.type === ChannelType.GuildVoice) {
              await freshChannel.setName(newName, 'Lab name update (queued)');
              rateLimitManager.recordNameChange(channel.id);
              logger.info(`Applied queued name change for lab to "${newName}"`);
            }
          } catch (error) {
            logger.error('Failed to apply queued name change:', error);
          }
        });
        nameChangeQueued = true;
        logger.info(`Name change to "${updates.name}" queued due to rate limit`);
      }
    }

    // Apply non-name updates immediately
    if (Object.keys(channelUpdates).length > 0) {
      await channel.edit(channelUpdates);

      // Record name change if we included it
      if (channelUpdates.name) {
        rateLimitManager.recordNameChange(channel.id);
      }
    }

    // Update database
    const dbUpdates: string[] = [];
    const dbValues: unknown[] = [];

    if (updates.name !== undefined) {
      dbUpdates.push('name = ?');
      dbValues.push(updates.name);
    }
    if (updates.isLocked !== undefined) {
      dbUpdates.push('is_locked = ?');
      dbValues.push(updates.isLocked);
    }

    if (dbUpdates.length > 0) {
      dbValues.push(lab.id);
      await this.db.execute(
        `UPDATE lab_channels SET ${dbUpdates.join(', ')} WHERE id = ?`,
        dbValues
      );
    }

    return { nameChangeQueued };
  }

  // ==================== Permitted Users ====================

  /**
   * Permit a user to join a locked lab
   */
  async permitUser(lab: LabChannel, userId: string, permittedBy: string, channel: VoiceBasedChannel): Promise<void> {
    const id = uuidv4();

    await this.db.execute(
      `INSERT INTO lab_permitted_users (id, lab_channel_id, user_id, permitted_by)
       VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [id, lab.id, userId, permittedBy]
    );

    // Update channel permissions
    await channel.permissionOverwrites.create(userId, {
      Connect: true,
      Speak: true,
    });
  }

  /**
   * Remove a user's permission to join a locked lab
   */
  async unpermitUser(lab: LabChannel, userId: string, channel: VoiceBasedChannel): Promise<void> {
    await this.db.execute(
      'DELETE FROM lab_permitted_users WHERE lab_channel_id = ? AND user_id = ?',
      [lab.id, userId]
    );

    // Remove channel permission override
    await channel.permissionOverwrites.delete(userId);
  }

  /**
   * Get all permitted users for a lab
   */
  async getPermittedUsers(labId: string): Promise<string[]> {
    const rows = await this.db.query<({ user_id: string } & RowDataPacket)[]>(
      'SELECT user_id FROM lab_permitted_users WHERE lab_channel_id = ?',
      [labId]
    );
    return rows.map(r => r.user_id);
  }

  /**
   * Kick a user from a lab
   */
  async kickUser(member: GuildMember, channel: VoiceBasedChannel): Promise<boolean> {
    try {
      if (member.voice.channelId === channel.id) {
        await member.voice.disconnect('Kicked from lab');
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Failed to kick user:', error);
      return false;
    }
  }

  // ==================== User Permit List (Persistent) ====================

  /**
   * Get a user's persistent permit list (stored per user, not per lab)
   * This list persists even when labs are destroyed and recreated
   */
  async getUserPermitList(ownerId: string, guildId: string): Promise<string[]> {
    const rows = await this.db.query<({ permitted_user_id: string } & RowDataPacket)[]>(
      'SELECT permitted_user_id FROM lab_user_permit_list WHERE owner_id = ? AND guild_id = ?',
      [ownerId, guildId]
    );
    return rows.map(r => r.permitted_user_id);
  }

  /**
   * Add a user to the owner's persistent permit list
   */
  async addToUserPermitList(ownerId: string, guildId: string, permittedUserId: string): Promise<void> {
    const id = uuidv4();
    await this.db.execute(
      `INSERT INTO lab_user_permit_list (id, owner_id, guild_id, permitted_user_id)
       VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [id, ownerId, guildId, permittedUserId]
    );
  }

  /**
   * Remove a user from the owner's persistent permit list
   */
  async removeFromUserPermitList(ownerId: string, guildId: string, permittedUserId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM lab_user_permit_list WHERE owner_id = ? AND guild_id = ? AND permitted_user_id = ?',
      [ownerId, guildId, permittedUserId]
    );
  }

  /**
   * Clear the owner's entire permit list
   */
  async clearUserPermitList(ownerId: string, guildId: string): Promise<void> {
    await this.db.execute(
      'DELETE FROM lab_user_permit_list WHERE owner_id = ? AND guild_id = ?',
      [ownerId, guildId]
    );
  }

  /**
   * Apply the owner's permit list to a channel (grant permissions to all permitted users)
   */
  async applyPermitListToChannel(ownerId: string, guildId: string, channel: VoiceBasedChannel): Promise<void> {
    const permitList = await this.getUserPermitList(ownerId, guildId);

    for (const userId of permitList) {
      try {
        await channel.permissionOverwrites.create(userId, {
          Connect: true,
          Speak: true,
        });
      } catch (error) {
        // User might not exist or have left the guild
        logger.debug(`Failed to apply permit for user ${userId}:`, error);
      }
    }
  }

  // ==================== Cleanup ====================

  /**
   * Check if a lab is empty and delete if so
   */
  async checkAndCleanupLab(channelId: string, guild: Guild): Promise<boolean> {
    const channel = guild.channels.cache.get(channelId);

    if (!channel || channel.type !== ChannelType.GuildVoice) {
      // Channel doesn't exist, clean up database
      // Get lab info first to remove flask from owner
      const lab = await this.getLabByChannel(channelId);
      if (lab) {
        try {
          const owner = await guild.members.fetch(lab.owner_id).catch(() => null);
          if (owner) {
            await this.removeFlaskFromNickname(owner);
          }
        } catch (error) {
          logger.debug('Could not remove flask from owner nickname during cleanup:', error);
        }
      }

      await this.db.execute('DELETE FROM lab_permitted_users WHERE lab_channel_id IN (SELECT id FROM lab_channels WHERE channel_id = ?)', [channelId]);
      await this.db.execute('DELETE FROM lab_channels WHERE channel_id = ?', [channelId]);
      return true;
    }

    const voiceChannel = channel as VoiceChannel;

    if (voiceChannel.members.size === 0) {
      await this.deleteLab(channelId, guild);
      return true;
    }

    return false;
  }

  // ==================== Lab Owner Nickname Management ====================

  /**
   * Add the flask emoji prefix to a member's nickname
   * Format: :🧪OriginalNickname (colon first for alphabetical sorting)
   */
  async addFlaskToNickname(member: GuildMember): Promise<boolean> {
    try {
      const currentNick = member.nickname || member.user.displayName;

      // Already has the flask prefix
      if (currentNick.startsWith(LAB_OWNER_PREFIX)) {
        return true;
      }

      const newNick = `${LAB_OWNER_PREFIX}${currentNick}`;

      // Discord nickname limit is 32 characters
      const truncatedNick = newNick.slice(0, 32);

      await member.setNickname(truncatedNick, 'Lab owner - adding flask prefix');
      logger.debug(`Added flask prefix to ${member.user.username}'s nickname`);
      return true;
    } catch (error) {
      logger.error(`Failed to add flask to ${member.user.username}'s nickname:`, error);
      return false;
    }
  }

  /**
   * Remove the flask emoji prefix from a member's nickname
   */
  async removeFlaskFromNickname(member: GuildMember): Promise<boolean> {
    try {
      const currentNick = member.nickname;

      // No nickname or doesn't have the flask prefix
      if (!currentNick || !currentNick.startsWith(LAB_OWNER_PREFIX)) {
        return true;
      }

      // Remove the prefix (:🧪)
      const newNick = currentNick.slice(LAB_OWNER_PREFIX.length);

      // If the remaining nickname is empty or equals their username, remove nickname entirely
      if (!newNick.trim() || newNick === member.user.username || newNick === member.user.displayName) {
        await member.setNickname(null, 'Lab closed - removing flask prefix');
      } else {
        await member.setNickname(newNick, 'Lab closed - removing flask prefix');
      }

      logger.debug(`Removed flask prefix from ${member.user.username}'s nickname`);
      return true;
    } catch (error) {
      logger.error(`Failed to remove flask from ${member.user.username}'s nickname:`, error);
      return false;
    }
  }

  /**
   * Check if a nickname contains the flask emoji (anywhere, not just prefix)
   */
  hasFlaskEmoji(nickname: string | null): boolean {
    if (!nickname) return false;
    return nickname.includes(LAB_OWNER_EMOJI);
  }

  /**
   * Remove any flask emojis from a nickname (for preventing manual addition)
   */
  async removeAnyFlaskFromNickname(member: GuildMember): Promise<boolean> {
    try {
      const currentNick = member.nickname;

      if (!currentNick || !this.hasFlaskEmoji(currentNick)) {
        return true;
      }

      // Remove all flask emojis from the nickname
      const newNick = currentNick.replace(new RegExp(LAB_OWNER_EMOJI, 'g'), '').trim();

      // Also remove any leading separator that might be left
      const cleanNick = newNick.replace(/^:+\s*/, '').trim();

      if (!cleanNick || cleanNick === member.user.username || cleanNick === member.user.displayName) {
        await member.setNickname(null, 'Removed unauthorized flask emoji');
      } else {
        await member.setNickname(cleanNick, 'Removed unauthorized flask emoji');
      }

      logger.debug(`Removed unauthorized flask emoji from ${member.user.username}'s nickname`);
      return true;
    } catch (error) {
      logger.error(`Failed to remove unauthorized flask from ${member.user.username}'s nickname:`, error);
      return false;
    }
  }
}
