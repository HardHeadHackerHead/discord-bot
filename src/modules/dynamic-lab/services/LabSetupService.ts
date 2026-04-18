import {
  Guild,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
  VoiceChannel,
  CategoryChannel,
  Collection,
} from 'discord.js';
import { LabService } from './LabService.js';
import { DatabaseService, RowDataPacket } from '../../../core/database/postgres.js';
import { Logger } from '../../../shared/utils/logger.js';
import { createHash } from 'crypto';

const logger = new Logger('DynamicLab:Setup');

// Constants
const GET_LAB_CHANNEL_NAME = '🧪 Get Lab Here';
const LABS_CATEGORY_NAME = '🔬 Labs';

/**
 * Info message configuration stored in database
 */
interface InfoMessageConfig {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string;
  content_hash: string;
}

/**
 * Module configuration per guild
 */
export interface ModuleConfig {
  id: string;
  guild_id: string;
  category_id: string | null;
  category_position: number;
  unload_behavior: 'keep' | 'delete_labs' | 'delete_all';
  auto_create_channel: boolean;
}

/**
 * Cleanup result information
 */
export interface CleanupResult {
  labsDeleted: number;
  channelsDeleted: string[];
  categoryDeleted: boolean;
  errors: string[];
}

/**
 * Service for setting up and managing the "Get Lab Here" channel
 */
export class LabSetupService {
  private db: DatabaseService;
  private labService: LabService;

  constructor(db: DatabaseService, labService: LabService) {
    this.db = db;
    this.labService = labService;
  }

  /**
   * Generate the info embed for the Get Lab Here channel
   */
  private createInfoEmbed(): EmbedBuilder {
    return new EmbedBuilder()
      .setTitle('🧪 Welcome to Dynamic Labs!')
      .setDescription(
        'Join this voice channel to create your own personal lab - a temporary voice channel where you are the admin.'
      )
      .setColor(0x5865F2)
      .addFields(
        {
          name: '🚀 How It Works',
          value: [
            '1. Join this channel',
            '2. A new lab is automatically created for you',
            '3. You\'ll be moved to your lab with full control',
            '4. Your lab is deleted when everyone leaves',
          ].join('\n'),
        },
        {
          name: '🎛️ Control Panel',
          value: 'When your lab is created, a control panel appears in the chat with buttons to manage your lab.',
        },
        {
          name: '🔒 Lock/Unlock',
          value: 'Lock your lab to prevent others from joining. Use "Permit User" to allow specific people into a locked lab.',
        },
        {
          name: '✏️ Rename',
          value: 'Change your lab\'s name. Your preference is saved for future labs.',
        },
        {
          name: '👥 User Limit',
          value: 'Set a maximum number of users who can be in your lab at once.',
        },
        {
          name: '👢 Kick User',
          value: 'Remove someone from your lab. They can rejoin unless the lab is locked.',
        },
        {
          name: '👑 Transfer Ownership',
          value: 'Hand over control of your lab to another member.',
        },
        {
          name: '💾 Saved Settings',
          value: 'Your preferences (name, limit, lock status) are remembered and applied to your future labs automatically.',
        },
      )
      .setFooter({ text: 'Your lab, your rules!' })
      .setTimestamp();
  }

  /**
   * Generate a hash of the embed content for comparison
   */
  private getEmbedHash(embed: EmbedBuilder): string {
    const content = JSON.stringify(embed.toJSON());
    return createHash('md5').update(content).digest('hex');
  }

  /**
   * Get the stored info message config for a guild
   */
  private async getInfoMessageConfig(guildId: string): Promise<InfoMessageConfig | null> {
    const rows = await this.db.query<(InfoMessageConfig & RowDataPacket)[]>(
      'SELECT * FROM lab_info_messages WHERE guild_id = ?',
      [guildId]
    );
    return rows[0] || null;
  }

  /**
   * Store/update the info message config
   */
  private async saveInfoMessageConfig(
    guildId: string,
    channelId: string,
    messageId: string,
    contentHash: string
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO lab_info_messages (id, guild_id, channel_id, message_id, content_hash)
       VALUES (gen_random_uuid(), ?, ?, ?, ?)
       ON CONFLICT (guild_id) DO UPDATE SET channel_id = EXCLUDED.channel_id, message_id = EXCLUDED.message_id, content_hash = EXCLUDED.content_hash`,
      [guildId, channelId, messageId, contentHash]
    );
  }

  /**
   * Ensure the "Get Lab Here" channel exists and is properly configured
   * Returns the channel if successful
   */
  async ensureGetLabChannel(guild: Guild): Promise<VoiceChannel | null> {
    try {
      // Check if we already have a creator channel registered for this guild
      const existingCreators = await this.labService.getCreatorsByGuild(guild.id);

      if (existingCreators.length > 0) {
        const firstCreator = existingCreators[0]!;
        // Check if the channel still exists
        const existingChannel = guild.channels.cache.get(firstCreator.channel_id);
        if (existingChannel && existingChannel.type === ChannelType.GuildVoice) {
          logger.debug(`Get Lab Here channel already exists in ${guild.name}`);
          return existingChannel as VoiceChannel;
        }
        // Channel was deleted, remove from database
        await this.labService.removeCreator(firstCreator.channel_id);
      }

      // Check if we have a saved category ID to use
      const config = await this.getModuleConfig(guild.id);

      // Find or create the Labs category
      let category: CategoryChannel | undefined;

      // First try to find by saved ID
      if (config?.category_id) {
        const savedCategory = guild.channels.cache.get(config.category_id);
        if (savedCategory && savedCategory.type === ChannelType.GuildCategory) {
          category = savedCategory as CategoryChannel;
          logger.debug(`Using saved category in ${guild.name}`);
        }
      }

      // If not found, try to find by name
      if (!category) {
        category = guild.channels.cache.find(
          c => c.type === ChannelType.GuildCategory && c.name === LABS_CATEGORY_NAME
        ) as CategoryChannel | undefined;
      }

      // If still not found, create new
      if (!category) {
        category = await guild.channels.create({
          name: LABS_CATEGORY_NAME,
          type: ChannelType.GuildCategory,
        });
        logger.info(`Created Labs category in ${guild.name}`);

        // Try to restore position if we have a saved one
        if (config?.category_position && config.category_position > 0) {
          try {
            await category.setPosition(config.category_position);
            logger.debug(`Restored category position to ${config.category_position} in ${guild.name}`);
          } catch (error) {
            logger.warn(`Failed to restore category position in ${guild.name}:`, error);
          }
        }
      }

      // Save the category ID for future reference
      await this.saveModuleConfig(guild.id, {
        category_id: category.id,
        category_position: category.position,
      });

      // Create the "Get Lab Here" voice channel
      const getLabChannel = await guild.channels.create({
        name: GET_LAB_CHANNEL_NAME,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: [PermissionFlagsBits.Connect, PermissionFlagsBits.ViewChannel],
            deny: [
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.AddReactions,
              PermissionFlagsBits.UseExternalEmojis,
              PermissionFlagsBits.UseExternalStickers,
              PermissionFlagsBits.AttachFiles,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
        ],
      });

      // Register as a lab creator
      await this.labService.createCreator(guild.id, getLabChannel.id, category.id);

      logger.info(`Created Get Lab Here channel in ${guild.name}`);

      // Post the info message
      await this.updateInfoMessage(guild, getLabChannel);

      return getLabChannel;

    } catch (error) {
      logger.error(`Failed to ensure Get Lab Here channel in ${guild.name}:`, error);
      return null;
    }
  }

  /**
   * Update the info message in the Get Lab Here channel
   * Only updates if the content has changed
   */
  async updateInfoMessage(guild: Guild, channel?: VoiceChannel): Promise<void> {
    try {
      // Find the channel if not provided
      if (!channel) {
        const creators = await this.labService.getCreatorsByGuild(guild.id);
        if (creators.length === 0) return;

        const firstCreator = creators[0]!;
        const foundChannel = guild.channels.cache.get(firstCreator.channel_id);
        if (!foundChannel || foundChannel.type !== ChannelType.GuildVoice) return;
        channel = foundChannel as VoiceChannel;
      }

      // Generate the new embed and its hash
      const embed = this.createInfoEmbed();
      const newHash = this.getEmbedHash(embed);

      // Check existing message config
      const config = await this.getInfoMessageConfig(guild.id);

      if (config) {
        // Check if content has changed
        if (config.content_hash === newHash) {
          logger.debug(`Info message unchanged in ${guild.name}, skipping update`);
          return;
        }

        // Try to delete old message
        try {
          const oldMessage = await channel.messages.fetch(config.message_id);
          await oldMessage.delete();
          logger.debug(`Deleted old info message in ${guild.name}`);
        } catch {
          // Message might not exist anymore, that's fine
        }
      }

      // Send new message
      const message = await channel.send({ embeds: [embed] });

      // Save config
      await this.saveInfoMessageConfig(guild.id, channel.id, message.id, newHash);

      logger.info(`Updated info message in ${guild.name}`);

    } catch (error) {
      logger.error(`Failed to update info message in ${guild.name}:`, error);
    }
  }

  /**
   * Set up Get Lab Here channels for all guilds the bot is in
   */
  async setupAllGuilds(guilds: Map<string, Guild>): Promise<void> {
    logger.info('Setting up Get Lab Here channels for all guilds...');

    let successCount = 0;
    let failCount = 0;

    for (const [guildId, guild] of guilds) {
      try {
        const channel = await this.ensureGetLabChannel(guild);
        if (channel) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        logger.error(`Failed to setup Get Lab Here in ${guild.name}:`, error);
        failCount++;
      }
    }

    logger.info(`Get Lab Here setup complete: ${successCount} success, ${failCount} failed`);
  }

  /**
   * Refresh info messages for all guilds (for when embed content changes)
   */
  async refreshAllInfoMessages(guilds: Map<string, Guild>): Promise<void> {
    logger.info('Refreshing info messages for all guilds...');

    for (const [guildId, guild] of guilds) {
      await this.updateInfoMessage(guild);
    }

    logger.info('Info message refresh complete');
  }

  // ==================== Module Configuration ====================

  /**
   * Get module configuration for a guild
   */
  async getModuleConfig(guildId: string): Promise<ModuleConfig | null> {
    const rows = await this.db.query<(ModuleConfig & RowDataPacket)[]>(
      'SELECT * FROM lab_module_config WHERE guild_id = ?',
      [guildId]
    );
    return rows[0] || null;
  }

  /**
   * Save/update module configuration for a guild
   */
  async saveModuleConfig(
    guildId: string,
    config: Partial<Omit<ModuleConfig, 'id' | 'guild_id'>>
  ): Promise<void> {
    const existing = await this.getModuleConfig(guildId);

    if (existing) {
      const updates: string[] = [];
      const values: unknown[] = [];

      if (config.category_id !== undefined) {
        updates.push('category_id = ?');
        values.push(config.category_id);
      }
      if (config.category_position !== undefined) {
        updates.push('category_position = ?');
        values.push(config.category_position);
      }
      if (config.unload_behavior !== undefined) {
        updates.push('unload_behavior = ?');
        values.push(config.unload_behavior);
      }
      if (config.auto_create_channel !== undefined) {
        updates.push('auto_create_channel = ?');
        values.push(config.auto_create_channel);
      }

      if (updates.length > 0) {
        values.push(guildId);
        await this.db.execute(
          `UPDATE lab_module_config SET ${updates.join(', ')} WHERE guild_id = ?`,
          values
        );
      }
    } else {
      await this.db.execute(
        `INSERT INTO lab_module_config (id, guild_id, category_id, category_position, unload_behavior, auto_create_channel)
         VALUES (gen_random_uuid(), ?, ?, ?, ?, ?)`,
        [
          guildId,
          config.category_id || null,
          config.category_position || 0,
          config.unload_behavior || 'delete_labs',
          config.auto_create_channel !== false,
        ]
      );
    }
  }

  /**
   * Store the current category position for later restoration
   */
  async saveCategoryPosition(guild: Guild, categoryId: string): Promise<void> {
    const category = guild.channels.cache.get(categoryId);
    if (category && category.type === ChannelType.GuildCategory) {
      await this.saveModuleConfig(guild.id, {
        category_id: categoryId,
        category_position: category.position,
      });
      logger.debug(`Saved category position ${category.position} for guild ${guild.name}`);
    }
  }

  // ==================== Cleanup Methods ====================

  /**
   * Delete all active labs for a guild
   */
  async deleteAllLabs(guild: Guild): Promise<{ deleted: number; errors: string[] }> {
    const errors: string[] = [];
    let deleted = 0;

    // Get all active labs for this guild
    const labs = await this.db.query<({ channel_id: string; name: string } & RowDataPacket)[]>(
      'SELECT channel_id, name FROM lab_channels WHERE guild_id = ?',
      [guild.id]
    );

    for (const lab of labs) {
      try {
        const channel = guild.channels.cache.get(lab.channel_id);
        if (channel) {
          await channel.delete('Module unloading - cleaning up labs');
          logger.debug(`Deleted lab channel ${lab.name}`);
        }
        deleted++;
      } catch (error) {
        const errorMsg = `Failed to delete lab ${lab.name}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        logger.error(errorMsg);
      }
    }

    // Clean up database records
    await this.db.execute(
      'DELETE FROM lab_permitted_users WHERE lab_channel_id IN (SELECT id FROM lab_channels WHERE guild_id = ?)',
      [guild.id]
    );
    await this.db.execute('DELETE FROM lab_channels WHERE guild_id = ?', [guild.id]);

    return { deleted, errors };
  }

  /**
   * Delete the Get Lab Here channel and optionally the category
   */
  async deleteSetupChannels(guild: Guild, deleteCategory: boolean = false): Promise<{ channelsDeleted: string[]; categoryDeleted: boolean; errors: string[] }> {
    const channelsDeleted: string[] = [];
    const errors: string[] = [];
    let categoryDeleted = false;

    // Get all creator channels for this guild
    const creators = await this.labService.getCreatorsByGuild(guild.id);

    for (const creator of creators) {
      try {
        const channel = guild.channels.cache.get(creator.channel_id);
        if (channel) {
          await channel.delete('Module unloading - removing Get Lab Here channel');
          channelsDeleted.push(creator.channel_id);
          logger.debug(`Deleted Get Lab Here channel in ${guild.name}`);
        }

        // Mark as inactive in database
        await this.labService.removeCreator(creator.channel_id);

        // Delete the category if requested and it exists
        if (deleteCategory && creator.category_id) {
          const category = guild.channels.cache.get(creator.category_id);
          if (category && category.type === ChannelType.GuildCategory) {
            // Only delete if empty (no other channels)
            const categoryChannel = category as CategoryChannel;
            if (categoryChannel.children.cache.size === 0) {
              await category.delete('Module unloading - removing empty Labs category');
              categoryDeleted = true;
              logger.debug(`Deleted Labs category in ${guild.name}`);
            } else {
              logger.debug(`Labs category not empty in ${guild.name}, keeping it`);
            }
          }
        }
      } catch (error) {
        const errorMsg = `Failed to delete setup channel: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(errorMsg);
        logger.error(errorMsg);
      }
    }

    // Clean up info messages from database
    await this.db.execute('DELETE FROM lab_info_messages WHERE guild_id = ?', [guild.id]);

    return { channelsDeleted, categoryDeleted, errors };
  }

  /**
   * Perform full cleanup for a guild based on its configuration
   */
  async cleanupGuild(guild: Guild, behavior?: 'keep' | 'delete_labs' | 'delete_all'): Promise<CleanupResult> {
    const result: CleanupResult = {
      labsDeleted: 0,
      channelsDeleted: [],
      categoryDeleted: false,
      errors: [],
    };

    // Get config or use provided behavior
    const config = await this.getModuleConfig(guild.id);
    const unloadBehavior = behavior || config?.unload_behavior || 'delete_labs';

    logger.info(`Cleaning up guild ${guild.name} with behavior: ${unloadBehavior}`);

    // Save category position before cleanup
    const creators = await this.labService.getCreatorsByGuild(guild.id);
    if (creators.length > 0 && creators[0]!.category_id) {
      await this.saveCategoryPosition(guild, creators[0]!.category_id);
    }

    switch (unloadBehavior) {
      case 'keep':
        // Don't delete anything, just clean up database state for active labs
        logger.info(`Keeping all channels in ${guild.name}`);
        break;

      case 'delete_labs':
        // Delete active labs but keep the Get Lab Here channel and category
        const labResult = await this.deleteAllLabs(guild);
        result.labsDeleted = labResult.deleted;
        result.errors.push(...labResult.errors);
        break;

      case 'delete_all':
        // Delete everything - active labs, Get Lab Here channel, and empty category
        const allLabsResult = await this.deleteAllLabs(guild);
        result.labsDeleted = allLabsResult.deleted;
        result.errors.push(...allLabsResult.errors);

        const channelResult = await this.deleteSetupChannels(guild, true);
        result.channelsDeleted = channelResult.channelsDeleted;
        result.categoryDeleted = channelResult.categoryDeleted;
        result.errors.push(...channelResult.errors);
        break;
    }

    return result;
  }

  /**
   * Perform cleanup for all guilds
   */
  async cleanupAllGuilds(guilds: Collection<string, Guild>, behavior?: 'keep' | 'delete_labs' | 'delete_all'): Promise<Map<string, CleanupResult>> {
    const results = new Map<string, CleanupResult>();

    logger.info(`Starting cleanup for ${guilds.size} guild(s)...`);

    for (const [guildId, guild] of guilds) {
      try {
        const result = await this.cleanupGuild(guild, behavior);
        results.set(guildId, result);
      } catch (error) {
        logger.error(`Failed to cleanup guild ${guild.name}:`, error);
        results.set(guildId, {
          labsDeleted: 0,
          channelsDeleted: [],
          categoryDeleted: false,
          errors: [error instanceof Error ? error.message : String(error)],
        });
      }
    }

    // Log summary
    let totalLabs = 0;
    let totalChannels = 0;
    let totalErrors = 0;
    for (const result of results.values()) {
      totalLabs += result.labsDeleted;
      totalChannels += result.channelsDeleted.length;
      totalErrors += result.errors.length;
    }

    logger.info(`Cleanup complete: ${totalLabs} labs deleted, ${totalChannels} channels deleted, ${totalErrors} errors`);

    return results;
  }

  /**
   * Restore category position after recreation
   */
  async restoreCategoryPosition(guild: Guild, categoryId: string): Promise<void> {
    const config = await this.getModuleConfig(guild.id);
    if (config && config.category_position > 0) {
      try {
        const category = guild.channels.cache.get(categoryId);
        if (category && category.type === ChannelType.GuildCategory) {
          await (category as CategoryChannel).setPosition(config.category_position);
          logger.debug(`Restored category position to ${config.category_position} in ${guild.name}`);
        }
      } catch (error) {
        logger.warn(`Failed to restore category position in ${guild.name}:`, error);
      }
    }
  }
}
