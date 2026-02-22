import {
  Guild,
  TextChannel,
  Message,
  EmbedBuilder,
  GuildMember,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { DatabaseService } from '../../../core/database/mysql.js';
import { Logger } from '../../../shared/utils/logger.js';
import { RowDataPacket } from 'mysql2';
import { randomUUID } from 'crypto';
import { COLORS } from '../../../shared/utils/embed.js';

const logger = new Logger('RoleManagement:Service');

export interface GuildSettings {
  id: string;
  guild_id: string;
  roles_channel_id: string | null;
}

export type SelectionMode = 'single' | 'multi';

export interface RoleMessage {
  id: string;
  guild_id: string;
  channel_id: string;
  message_id: string;
  title: string | null;
  description: string | null;
  selection_mode: SelectionMode;
  created_by: string;
  created_at: Date;
}

export interface MessageRole {
  id: string;
  message_id: string;
  role_id: string;
  description: string | null;
  position: number;
}

export class RoleService {
  constructor(private db: DatabaseService) {}

  // ==================== Guild Settings ====================

  async getGuildSettings(guildId: string): Promise<GuildSettings | null> {
    const rows = await this.db.query<(GuildSettings & RowDataPacket)[]>(
      'SELECT * FROM roles_guild_settings WHERE guild_id = ?',
      [guildId]
    );
    return rows[0] || null;
  }

  async setRolesChannel(guildId: string, channelId: string): Promise<void> {
    const existing = await this.getGuildSettings(guildId);

    if (existing) {
      await this.db.execute(
        'UPDATE roles_guild_settings SET roles_channel_id = ? WHERE guild_id = ?',
        [channelId, guildId]
      );
    } else {
      await this.db.execute(
        'INSERT INTO roles_guild_settings (id, guild_id, roles_channel_id) VALUES (?, ?, ?)',
        [randomUUID(), guildId, channelId]
      );
    }

    logger.debug(`Set roles channel for guild ${guildId} to ${channelId}`);
  }

  async getRolesChannel(guildId: string): Promise<string | null> {
    const settings = await this.getGuildSettings(guildId);
    return settings?.roles_channel_id || null;
  }

  // ==================== Role Messages ====================

  async createRoleMessage(
    guild: Guild,
    channel: TextChannel,
    title: string,
    description: string,
    selectionMode: SelectionMode,
    createdBy: string
  ): Promise<{ message: Message; dbRecord: RoleMessage } | null> {
    try {
      // Create the embed (no roles yet)
      const embed = this.buildRoleMessageEmbed(title, description, [], selectionMode);

      // Send the message with a placeholder (no dropdown yet since no roles)
      const message = await channel.send({
        embeds: [embed],
      });

      // Store in database
      const id = randomUUID();
      await this.db.execute(
        `INSERT INTO roles_reaction_messages
         (id, guild_id, channel_id, message_id, title, description, selection_mode, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, guild.id, channel.id, message.id, title, description, selectionMode, createdBy]
      );

      const dbRecord: RoleMessage = {
        id,
        guild_id: guild.id,
        channel_id: channel.id,
        message_id: message.id,
        title,
        description,
        selection_mode: selectionMode,
        created_by: createdBy,
        created_at: new Date(),
      };

      logger.info(`Created role message in ${guild.name}#${channel.name}`);
      return { message, dbRecord };
    } catch (error) {
      logger.error('Failed to create role message:', error);
      return null;
    }
  }

  async setSelectionMode(dbMessageId: string, mode: SelectionMode): Promise<boolean> {
    try {
      await this.db.execute(
        'UPDATE roles_reaction_messages SET selection_mode = ? WHERE id = ?',
        [mode, dbMessageId]
      );
      logger.debug(`Set selection mode to ${mode} for message ${dbMessageId}`);
      return true;
    } catch (error) {
      logger.error('Failed to set selection mode:', error);
      return false;
    }
  }

  async getRoleMessage(messageId: string): Promise<RoleMessage | null> {
    const rows = await this.db.query<(RoleMessage & RowDataPacket)[]>(
      'SELECT * FROM roles_reaction_messages WHERE message_id = ?',
      [messageId]
    );
    return rows[0] || null;
  }

  async getRoleMessageById(id: string): Promise<RoleMessage | null> {
    const rows = await this.db.query<(RoleMessage & RowDataPacket)[]>(
      'SELECT * FROM roles_reaction_messages WHERE id = ?',
      [id]
    );
    return rows[0] || null;
  }

  async getRoleMessagesByGuild(guildId: string): Promise<RoleMessage[]> {
    return this.db.query<(RoleMessage & RowDataPacket)[]>(
      'SELECT * FROM roles_reaction_messages WHERE guild_id = ? ORDER BY created_at DESC',
      [guildId]
    );
  }

  async deleteRoleMessage(messageId: string, guild: Guild): Promise<boolean> {
    try {
      const record = await this.getRoleMessage(messageId);
      if (!record) return false;

      // Try to delete the Discord message
      try {
        const channel = guild.channels.cache.get(record.channel_id) as TextChannel;
        if (channel) {
          const message = await channel.messages.fetch(messageId);
          await message.delete();
        }
      } catch {
        // Message might already be deleted
      }

      // Delete from database (cascade will delete roles)
      await this.db.execute(
        'DELETE FROM roles_reaction_messages WHERE message_id = ?',
        [messageId]
      );

      logger.info(`Deleted role message ${messageId}`);
      return true;
    } catch (error) {
      logger.error('Failed to delete role message:', error);
      return false;
    }
  }

  async repostRoleMessage(messageId: string, guild: Guild): Promise<{ newMessageId: string } | null> {
    try {
      const record = await this.getRoleMessage(messageId);
      if (!record) return null;

      const channel = guild.channels.cache.get(record.channel_id) as TextChannel;
      if (!channel) {
        logger.error(`Channel ${record.channel_id} not found for repost`);
        return null;
      }

      // Try to delete the old Discord message
      try {
        const oldMessage = await channel.messages.fetch(messageId);
        await oldMessage.delete();
      } catch {
        // Message might already be deleted, that's fine
      }

      // Get all roles for this message to rebuild embed
      const dbRoles = await this.getMessageRoles(record.id);

      // Build role info with names
      const roles = dbRoles
        .map((r) => {
          const role = guild.roles.cache.get(r.role_id);
          if (!role) return null;
          return {
            roleId: r.role_id,
            roleName: role.name,
            description: r.description,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      // Build new embed and components
      const embed = this.buildRoleMessageEmbed(record.title, record.description, roles, record.selection_mode);
      const selectRow = this.buildRoleSelectMenu(roles, '', record.selection_mode); // Temp message ID

      // Post the new message
      const newMessage = await channel.send({
        embeds: [embed],
        components: selectRow ? [selectRow] : [],
      });

      // Update the select menu with the correct message ID
      const correctSelectRow = this.buildRoleSelectMenu(roles, newMessage.id, record.selection_mode);
      if (correctSelectRow) {
        await newMessage.edit({
          embeds: [embed],
          components: [correctSelectRow],
        });
      }

      // Update the database with the new message ID
      await this.db.execute(
        'UPDATE roles_reaction_messages SET message_id = ? WHERE id = ?',
        [newMessage.id, record.id]
      );

      logger.info(`Reposted role message ${messageId} -> ${newMessage.id}`);
      return { newMessageId: newMessage.id };
    } catch (error) {
      logger.error('Failed to repost role message:', error);
      return null;
    }
  }

  // ==================== Message Roles ====================

  async addRoleToMessage(dbMessageId: string, roleId: string, description?: string): Promise<boolean> {
    try {
      // Get the next position (max position + 1)
      const maxPosResult = await this.db.query<({ max_pos: number | null } & RowDataPacket)[]>(
        'SELECT MAX(position) as max_pos FROM roles_reaction_roles WHERE message_id = ?',
        [dbMessageId]
      );
      const nextPosition = (maxPosResult[0]?.max_pos ?? -1) + 1;

      await this.db.execute(
        `INSERT INTO roles_reaction_roles (id, message_id, role_id, description, position)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), dbMessageId, roleId, description || null, nextPosition]
      );

      logger.debug(`Added role ${roleId} to message ${dbMessageId} at position ${nextPosition}`);
      return true;
    } catch (error) {
      logger.error('Failed to add role to message:', error);
      return false;
    }
  }

  async removeRoleFromMessage(dbMessageId: string, roleId: string): Promise<boolean> {
    try {
      const result = await this.db.execute(
        'DELETE FROM roles_reaction_roles WHERE message_id = ? AND role_id = ?',
        [dbMessageId, roleId]
      );

      return (result as { affectedRows: number }).affectedRows > 0;
    } catch (error) {
      logger.error('Failed to remove role from message:', error);
      return false;
    }
  }

  async getMessageRoles(dbMessageId: string): Promise<MessageRole[]> {
    return this.db.query<(MessageRole & RowDataPacket)[]>(
      'SELECT * FROM roles_reaction_roles WHERE message_id = ? ORDER BY position ASC',
      [dbMessageId]
    );
  }

  async getRoleFromMessage(dbMessageId: string, roleId: string): Promise<MessageRole | null> {
    const rows = await this.db.query<(MessageRole & RowDataPacket)[]>(
      'SELECT * FROM roles_reaction_roles WHERE message_id = ? AND role_id = ?',
      [dbMessageId, roleId]
    );
    return rows[0] || null;
  }

  async updateRoleDescription(dbMessageId: string, roleId: string, description: string | null): Promise<boolean> {
    try {
      await this.db.execute(
        'UPDATE roles_reaction_roles SET description = ? WHERE message_id = ? AND role_id = ?',
        [description, dbMessageId, roleId]
      );
      logger.debug(`Updated description for role ${roleId} in message ${dbMessageId}`);
      return true;
    } catch (error) {
      logger.error('Failed to update role description:', error);
      return false;
    }
  }

  async moveRoleUp(dbMessageId: string, roleId: string): Promise<boolean> {
    try {
      const roles = await this.getMessageRoles(dbMessageId);
      const currentIndex = roles.findIndex((r) => r.role_id === roleId);

      if (currentIndex <= 0) return false; // Already at top or not found

      const currentRole = roles[currentIndex];
      const aboveRole = roles[currentIndex - 1];

      if (!currentRole || !aboveRole) return false;

      // Swap positions
      await this.db.execute(
        'UPDATE roles_reaction_roles SET position = ? WHERE message_id = ? AND role_id = ?',
        [aboveRole.position, dbMessageId, roleId]
      );
      await this.db.execute(
        'UPDATE roles_reaction_roles SET position = ? WHERE message_id = ? AND role_id = ?',
        [currentRole.position, dbMessageId, aboveRole.role_id]
      );

      logger.debug(`Moved role ${roleId} up in message ${dbMessageId}`);
      return true;
    } catch (error) {
      logger.error('Failed to move role up:', error);
      return false;
    }
  }

  async moveRoleDown(dbMessageId: string, roleId: string): Promise<boolean> {
    try {
      const roles = await this.getMessageRoles(dbMessageId);
      const currentIndex = roles.findIndex((r) => r.role_id === roleId);

      if (currentIndex < 0 || currentIndex >= roles.length - 1) return false; // At bottom or not found

      const currentRole = roles[currentIndex];
      const belowRole = roles[currentIndex + 1];

      if (!currentRole || !belowRole) return false;

      // Swap positions
      await this.db.execute(
        'UPDATE roles_reaction_roles SET position = ? WHERE message_id = ? AND role_id = ?',
        [belowRole.position, dbMessageId, roleId]
      );
      await this.db.execute(
        'UPDATE roles_reaction_roles SET position = ? WHERE message_id = ? AND role_id = ?',
        [currentRole.position, dbMessageId, belowRole.role_id]
      );

      logger.debug(`Moved role ${roleId} down in message ${dbMessageId}`);
      return true;
    } catch (error) {
      logger.error('Failed to move role down:', error);
      return false;
    }
  }

  // ==================== Role Assignment ====================

  async toggleRole(member: GuildMember, roleId: string): Promise<{ added: boolean } | null> {
    try {
      const role = member.guild.roles.cache.get(roleId);
      if (!role) {
        logger.warn(`Role ${roleId} not found in guild ${member.guild.id}`);
        return null;
      }

      // Check if bot can manage this role
      const botMember = member.guild.members.me;
      if (!botMember) return null;

      if (role.position >= botMember.roles.highest.position) {
        logger.warn(`Cannot manage role ${role.name} - higher than bot's highest role`);
        return null;
      }

      // Toggle the role
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(role);
        logger.debug(`Removed role ${role.name} from ${member.user.username}`);
        return { added: false };
      } else {
        await member.roles.add(role);
        logger.debug(`Added role ${role.name} to ${member.user.username}`);
        return { added: true };
      }
    } catch (error) {
      logger.error('Failed to toggle role:', error);
      return null;
    }
  }

  // ==================== Message Updates ====================

  buildRoleMessageEmbed(
    title: string | null,
    description: string | null,
    roles: { roleId: string; roleName: string; description: string | null }[],
    selectionMode: SelectionMode
  ): EmbedBuilder {
    const embed = new EmbedBuilder()
      .setTitle(title || 'Self-Assignable Roles')
      .setColor(COLORS.primary);

    let desc = description || '';
    if (desc) desc += '\n\n';

    // Show selection mode indicator
    const modeText = selectionMode === 'single'
      ? '*(Pick one)*'
      : '*(Pick any)*';

    if (roles.length === 0) {
      desc += '*No roles available yet.*';
    } else {
      desc += `${modeText}\n\n`;
      for (const r of roles) {
        desc += `<@&${r.roleId}>`;
        if (r.description) {
          desc += ` - ${r.description}`;
        }
        desc += '\n';
      }

      desc += '\n';
      if (selectionMode === 'single') {
        desc += '*Select a role from the dropdown. Choosing a new role will replace your current one.*';
      } else {
        desc += '*Select a role from the dropdown to add or remove it.*';
      }
    }

    embed.setDescription(desc);
    return embed;
  }

  buildRoleSelectMenu(
    roles: { roleId: string; roleName: string; description: string | null }[],
    messageId: string,
    selectionMode: SelectionMode
  ): ActionRowBuilder<StringSelectMenuBuilder> | null {
    if (roles.length === 0) return null;

    const options = roles.map((r) =>
      new StringSelectMenuOptionBuilder()
        .setLabel(r.roleName)
        .setDescription(r.description || (selectionMode === 'single' ? 'Click to select this role' : 'Click to toggle this role'))
        .setValue(r.roleId)
    );

    const select = new StringSelectMenuBuilder()
      .setCustomId(`selfrole:select:${messageId}`)
      .setPlaceholder(selectionMode === 'single' ? 'Choose a role...' : 'Select roles to add/remove...')
      .addOptions(options);

    // For single mode, only allow one selection at a time
    // For multi mode, we still use maxValues=1 but allow toggling
    // (Discord doesn't support "toggle" mode, so we handle it in the event handler)

    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  }

  async updateRoleMessageEmbed(guild: Guild, record: RoleMessage): Promise<boolean> {
    try {
      const channel = guild.channels.cache.get(record.channel_id) as TextChannel;
      if (!channel) return false;

      const message = await channel.messages.fetch(record.message_id);
      if (!message) return false;

      // Get all roles for this message
      const dbRoles = await this.getMessageRoles(record.id);

      // Build role info with names
      const roles = dbRoles
        .map((r) => {
          const role = guild.roles.cache.get(r.role_id);
          if (!role) return null;
          return {
            roleId: r.role_id,
            roleName: role.name,
            description: r.description,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      // Build embed with selection mode
      const embed = this.buildRoleMessageEmbed(record.title, record.description, roles, record.selection_mode);

      // Build select menu with selection mode
      const selectRow = this.buildRoleSelectMenu(roles, record.message_id, record.selection_mode);

      // Update message
      await message.edit({
        embeds: [embed],
        components: selectRow ? [selectRow] : [],
      });

      return true;
    } catch (error) {
      logger.error('Failed to update role message embed:', error);
      return false;
    }
  }
}
