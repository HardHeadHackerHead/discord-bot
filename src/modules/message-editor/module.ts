import {
  BaseModule,
  ModuleMetadata,
  ModuleContext,
} from '../../types/module.types.js';
import { AnyModuleEvent } from '../../types/event.types.js';
import {
  MessageReaction,
  User,
  PartialMessageReaction,
  PartialUser,
  Message,
  PartialMessage,
  PermissionFlagsBits,
  EmbedBuilder,
  APIEmbed,
  Client,
  TextChannel,
} from 'discord.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('MessageEditor');

/** Pencil emoji for triggering edit mode */
const EDIT_EMOJI = '✏️';

/** Eraser emoji for deleting messages */
const DELETE_EMOJI = '🧹';

/** Pin emoji for pinning/unpinning messages */
const PIN_EMOJI = '📌';

/** Copy emoji for cloning a message to another channel */
const COPY_EMOJI = '📋';

/** Timeout in milliseconds (30 seconds) */
const EDIT_TIMEOUT_MS = 30_000;

/** Timeout for copy destination selection (30 seconds) */
const COPY_TIMEOUT_MS = 30_000;

/**
 * Pending edit session
 */
interface PendingEdit {
  messageId: string;
  channelId: string;
  guildId: string;
  userId: string;
  timeout: NodeJS.Timeout;
}

/**
 * Pending copy session
 */
interface PendingCopy {
  messageId: string;
  channelId: string;
  guildId: string;
  userId: string;
  timeout: NodeJS.Timeout;
}

/**
 * JSON message format for edits
 */
interface MessageEditPayload {
  content?: string;
  embeds?: APIEmbed[];
}

/** Map of pending edits: `${channelId}-${userId}` -> PendingEdit */
const pendingEdits: Map<string, PendingEdit> = new Map();

/** Map of pending copies: `${channelId}-${userId}` -> PendingCopy */
const pendingCopies: Map<string, PendingCopy> = new Map();

/** Store client reference for event handlers */
let clientRef: Client | null = null;

/**
 * Handle edit timeout - remove the reaction
 */
async function handleEditTimeout(
  pendingKey: string,
  channelId: string,
  messageId: string,
  userId: string
): Promise<void> {
  const pending = pendingEdits.get(pendingKey);
  if (!pending) return;

  pendingEdits.delete(pendingKey);

  try {
    if (!clientRef) return;

    const channel = await clientRef.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return;

    const message = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
    if (!message) return;

    const pencilReaction = message.reactions.cache.find(r => r.emoji.name === EDIT_EMOJI);
    if (pencilReaction) {
      await pencilReaction.users.remove(userId).catch(() => {});
    }

    logger.debug(`Edit timeout for message ${messageId}, removed reaction`);
  } catch (error) {
    logger.error('Error removing reaction on timeout:', error);
  }
}

/**
 * Handle copy timeout - remove the reaction
 */
async function handleCopyTimeout(
  pendingKey: string,
  channelId: string,
  messageId: string,
  userId: string
): Promise<void> {
  const pending = pendingCopies.get(pendingKey);
  if (!pending) return;

  pendingCopies.delete(pendingKey);

  try {
    if (!clientRef) return;

    const channel = await clientRef.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) return;

    const message = await (channel as TextChannel).messages.fetch(messageId).catch(() => null);
    if (!message) return;

    const copyReaction = message.reactions.cache.find(r => r.emoji.name === COPY_EMOJI);
    if (copyReaction) {
      await copyReaction.users.remove(userId).catch(() => {});
    }

    logger.debug(`Copy timeout for message ${messageId}, removed reaction`);
  } catch (error) {
    logger.error('Error removing reaction on timeout:', error);
  }
}

/**
 * Reaction add event handler
 */
const messageReactionAddEvent: AnyModuleEvent = {
  name: 'messageReactionAdd',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const reaction = args[0] as MessageReaction | PartialMessageReaction;
    const user = args[1] as User | PartialUser;

    // Ignore bot reactions
    if (user.bot) return;

    const emojiName = reaction.emoji.name;

    // Check if it's one of our supported emojis
    if (![EDIT_EMOJI, DELETE_EMOJI, PIN_EMOJI, COPY_EMOJI].includes(emojiName || '')) {
      return;
    }

    try {
      // Fetch partial reaction if needed
      let fullReaction = reaction;
      if (reaction.partial) {
        fullReaction = await reaction.fetch();
      }

      const message = fullReaction.message;

      // Fetch partial message if needed
      if (message.partial) {
        await message.fetch();
      }

      // Must be in a guild
      if (!message.guild) return;

      // Must be a bot message
      if (message.author?.id !== clientRef?.user?.id) {
        return;
      }

      // Fetch the member to check permissions
      const member = await message.guild.members.fetch(user.id).catch(() => null);
      if (!member) return;

      // Check if user has ManageMessages permission (administrators have this)
      if (!member.permissions.has(PermissionFlagsBits.ManageMessages)) {
        // Remove the reaction since they don't have permission
        await fullReaction.users.remove(user.id).catch(() => {});
        return;
      }

      // Handle based on emoji type
      // Note: fullReaction is guaranteed to be a full MessageReaction after fetch
      const fetchedReaction = fullReaction as MessageReaction;

      switch (emojiName) {
        case EDIT_EMOJI:
          await handleEditReaction(message, user, fetchedReaction);
          break;

        case DELETE_EMOJI:
          await handleDeleteReaction(message, user);
          break;

        case PIN_EMOJI:
          await handlePinReaction(message, user, fetchedReaction);
          break;

        case COPY_EMOJI:
          await handleCopyReaction(message, user, fetchedReaction);
          break;
      }

    } catch (error) {
      logger.error('Error handling reaction add:', error);
    }
  },
};

/**
 * Handle pencil emoji - start edit mode
 */
async function handleEditReaction(
  message: Message | PartialMessage,
  user: User | PartialUser,
  reaction: MessageReaction
): Promise<void> {
  const pendingKey = `${message.channelId}-${user.id}`;

  // Cancel any existing pending edit
  const existingPending = pendingEdits.get(pendingKey);
  if (existingPending) {
    clearTimeout(existingPending.timeout);
    pendingEdits.delete(pendingKey);
  }

  // Create pending edit
  const pending: PendingEdit = {
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guild!.id,
    userId: user.id,
    timeout: setTimeout(() => {
      handleEditTimeout(pendingKey, message.channelId, message.id, user.id);
    }, EDIT_TIMEOUT_MS),
  };

  pendingEdits.set(pendingKey, pending);
  logger.debug(`Edit mode started for message ${message.id} by user ${user.id}`);
}

/**
 * Handle eraser emoji - delete the message
 */
async function handleDeleteReaction(
  message: Message | PartialMessage,
  user: User | PartialUser
): Promise<void> {
  try {
    await message.delete();
    logger.info(`Message ${message.id} deleted by user ${user.id}`);
  } catch (error) {
    logger.error(`Failed to delete message ${message.id}:`, error);
  }
}

/**
 * Handle pin emoji - toggle pin status
 */
async function handlePinReaction(
  message: Message | PartialMessage,
  user: User | PartialUser,
  reaction: MessageReaction
): Promise<void> {
  try {
    // Fetch full message to check pin status
    const fullMessage = message.partial ? await message.fetch() : message;

    // Check if channel supports pinning (news/announcement channels don't)
    const channel = fullMessage.channel;
    if (channel.isThread() || channel.type === 5) { // 5 = GuildAnnouncement/News
      logger.debug(`Cannot pin in channel type ${channel.type}`);
      await reaction.users.remove(user.id).catch(() => {});
      return;
    }

    if (fullMessage.pinned) {
      await fullMessage.unpin();
      logger.info(`Message ${message.id} unpinned by user ${user.id}`);
    } else {
      await fullMessage.pin();
      logger.info(`Message ${message.id} pinned by user ${user.id}`);
    }

    // Remove the reaction after action
    await reaction.users.remove(user.id).catch(() => {});
  } catch (error: unknown) {
    // Handle specific Discord API errors gracefully
    const discordError = error as { code?: number };
    if (discordError.code === 50019) {
      // "This message cannot be pinned in this channel"
      logger.debug(`Cannot pin message ${message.id} - channel doesn't support pinning`);
    } else {
      logger.error(`Failed to toggle pin for message ${message.id}:`, error);
    }
    await reaction.users.remove(user.id).catch(() => {});
  }
}

/**
 * Handle copy emoji - start copy mode (user mentions target channel)
 */
async function handleCopyReaction(
  message: Message | PartialMessage,
  user: User | PartialUser,
  reaction: MessageReaction
): Promise<void> {
  const pendingKey = `${message.channelId}-${user.id}`;

  // Cancel any existing pending copy
  const existingPending = pendingCopies.get(pendingKey);
  if (existingPending) {
    clearTimeout(existingPending.timeout);
    pendingCopies.delete(pendingKey);
  }

  // Create pending copy
  const pending: PendingCopy = {
    messageId: message.id,
    channelId: message.channelId,
    guildId: message.guild!.id,
    userId: user.id,
    timeout: setTimeout(() => {
      handleCopyTimeout(pendingKey, message.channelId, message.id, user.id);
    }, COPY_TIMEOUT_MS),
  };

  pendingCopies.set(pendingKey, pending);
  logger.debug(`Copy mode started for message ${message.id} by user ${user.id}`);
}

/**
 * Message create event handler
 */
const messageCreateEvent: AnyModuleEvent = {
  name: 'messageCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const message = args[0] as Message;

    // Ignore bot messages
    if (message.author?.bot) return;

    // Must be in a guild
    if (!message.guild) return;

    const pendingKey = `${message.channelId}-${message.author?.id}`;

    // Check if this user has a pending edit in this channel
    const pendingEdit = pendingEdits.get(pendingKey);
    if (pendingEdit) {
      await handleEditMessage(message, pendingEdit, pendingKey);
      return;
    }

    // Check if this user has a pending copy in this channel
    const pendingCopy = pendingCopies.get(pendingKey);
    if (pendingCopy) {
      await handleCopyMessage(message, pendingCopy, pendingKey);
      return;
    }
  },
};

/**
 * Handle message for pending edit
 */
async function handleEditMessage(
  message: Message,
  pending: PendingEdit,
  pendingKey: string
): Promise<void> {
  try {
    // Clear the timeout
    clearTimeout(pending.timeout);
    pendingEdits.delete(pendingKey);

    // Fetch the original bot message
    const channel = await clientRef?.channels.fetch(pending.channelId);
    if (!channel || !channel.isTextBased() || !('messages' in channel)) {
      return;
    }

    const botMessage = await (channel as TextChannel).messages.fetch(pending.messageId).catch(() => null);
    if (!botMessage) {
      logger.warn(`Could not find message ${pending.messageId} to edit`);
      return;
    }

    // Parse the user's message
    const editContent = message.content || '';
    let newContent: string | undefined;
    let newEmbeds: EmbedBuilder[] | undefined;

    // Try to parse as JSON first
    if (editContent.trim().startsWith('{')) {
      try {
        const payload = JSON.parse(editContent) as MessageEditPayload;

        if (payload.content !== undefined) {
          newContent = payload.content;
        }

        if (payload.embeds && Array.isArray(payload.embeds)) {
          newEmbeds = payload.embeds.map(e => EmbedBuilder.from(e));
        }
      } catch {
        // Not valid JSON, treat as plain text
        newContent = editContent;
      }
    } else {
      // Plain text
      newContent = editContent;
    }

    // Edit the bot message
    await botMessage.edit({
      content: newContent ?? null,
      embeds: newEmbeds ?? [],
    });

    // Delete the user's edit message
    await message.delete().catch(() => {});

    // Remove the pencil reaction from the bot message
    const pencilReaction = botMessage.reactions.cache.find(r => r.emoji.name === EDIT_EMOJI);
    if (pencilReaction) {
      await pencilReaction.users.remove(pending.userId).catch(() => {});
    }

    logger.info(`Message ${pending.messageId} edited by user ${pending.userId}`);

  } catch (error) {
    logger.error('Error handling message edit:', error);
  }
}

/**
 * Handle message for pending copy (user mentions target channel)
 */
async function handleCopyMessage(
  message: Message,
  pending: PendingCopy,
  pendingKey: string
): Promise<void> {
  try {
    // Clear the timeout
    clearTimeout(pending.timeout);
    pendingCopies.delete(pendingKey);

    // Check if the message mentions a channel
    const targetChannel = message.mentions.channels.first();
    if (!targetChannel || !targetChannel.isTextBased() || !('send' in targetChannel)) {
      // Delete the user's message and remove reaction
      await message.delete().catch(() => {});

      const sourceChannel = await clientRef?.channels.fetch(pending.channelId);
      if (sourceChannel && 'messages' in sourceChannel) {
        const botMessage = await (sourceChannel as TextChannel).messages.fetch(pending.messageId).catch(() => null);
        if (botMessage) {
          const copyReaction = botMessage.reactions.cache.find(r => r.emoji.name === COPY_EMOJI);
          if (copyReaction) {
            await copyReaction.users.remove(pending.userId).catch(() => {});
          }
        }
      }
      return;
    }

    // Fetch the original bot message
    const sourceChannel = await clientRef?.channels.fetch(pending.channelId);
    if (!sourceChannel || !('messages' in sourceChannel)) {
      return;
    }

    const botMessage = await (sourceChannel as TextChannel).messages.fetch(pending.messageId).catch(() => null);
    if (!botMessage) {
      logger.warn(`Could not find message ${pending.messageId} to copy`);
      return;
    }

    // Copy the message to the target channel
    await (targetChannel as TextChannel).send({
      content: botMessage.content || undefined,
      embeds: botMessage.embeds.map(e => EmbedBuilder.from(e)),
    });

    // Delete the user's message
    await message.delete().catch(() => {});

    // Remove the copy reaction from the original message
    const copyReaction = botMessage.reactions.cache.find(r => r.emoji.name === COPY_EMOJI);
    if (copyReaction) {
      await copyReaction.users.remove(pending.userId).catch(() => {});
    }

    logger.info(`Message ${pending.messageId} copied to ${targetChannel.id} by user ${pending.userId}`);

  } catch (error) {
    logger.error('Error handling message copy:', error);
  }
}

/**
 * Message Editor Module
 * Allows administrators to edit bot messages by reacting with a pencil emoji
 */
export class MessageEditorModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'message-editor',
    name: 'Message Editor',
    description: 'Edit bot messages by reacting with a pencil emoji',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: [],
    priority: 50,
  };

  constructor() {
    super();

    this.commands = [];
    this.events = [
      messageReactionAddEvent,
      messageCreateEvent,
    ];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);
    clientRef = context.client;
    logger.info('Message Editor module loaded');
  }

  async onUnload(): Promise<void> {
    // Clear all pending edits
    for (const [key, pending] of pendingEdits) {
      clearTimeout(pending.timeout);
      pendingEdits.delete(key);
    }

    // Clear all pending copies
    for (const [key, pending] of pendingCopies) {
      clearTimeout(pending.timeout);
      pendingCopies.delete(key);
    }

    clientRef = null;
    await super.onUnload();
    logger.info('Message Editor module unloaded');
  }
}
