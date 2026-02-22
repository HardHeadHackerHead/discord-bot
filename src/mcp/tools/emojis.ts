import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getGuild } from '../discord-client.js';
import { StickerFormatType } from 'discord.js';

/**
 * Emoji and sticker management tools
 */

export const emojiTools: Tool[] = [
  {
    name: 'list_emojis',
    description: 'List all custom emojis in the server, including name, ID, animated status, URL, creation date, and whether they require colons.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_emoji',
    description: 'Upload a new custom emoji to the server from an image URL.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name for the new emoji',
        },
        imageUrl: {
          type: 'string',
          description: 'URL to the image file to use as the emoji',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the audit log',
        },
      },
      required: ['name', 'imageUrl'],
    },
  },
  {
    name: 'delete_emoji',
    description: 'Remove a custom emoji from the server by name or ID.',
    inputSchema: {
      type: 'object',
      properties: {
        emoji: {
          type: 'string',
          description: 'The name or ID of the emoji to delete',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the audit log',
        },
      },
      required: ['emoji'],
    },
  },
  {
    name: 'rename_emoji',
    description: 'Rename an existing custom emoji by its current name or ID.',
    inputSchema: {
      type: 'object',
      properties: {
        emoji: {
          type: 'string',
          description: 'The current name or ID of the emoji to rename',
        },
        newName: {
          type: 'string',
          description: 'The new name for the emoji',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the audit log',
        },
      },
      required: ['emoji', 'newName'],
    },
  },
  {
    name: 'list_stickers',
    description: 'List all custom stickers in the server, including name, ID, description, tags, format, URL, and creation date.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_sticker',
    description: 'Upload a new custom sticker to the server from a file URL.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name for the new sticker',
        },
        description: {
          type: 'string',
          description: 'A description of the sticker',
        },
        tags: {
          type: 'string',
          description: 'The emoji tag for the sticker (e.g., "smile")',
        },
        fileUrl: {
          type: 'string',
          description: 'URL to the file to use as the sticker',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the audit log',
        },
      },
      required: ['name', 'description', 'tags', 'fileUrl'],
    },
  },
  {
    name: 'delete_sticker',
    description: 'Remove a custom sticker from the server by name or ID.',
    inputSchema: {
      type: 'object',
      properties: {
        sticker: {
          type: 'string',
          description: 'The name or ID of the sticker to delete',
        },
        reason: {
          type: 'string',
          description: 'Optional reason for the audit log',
        },
      },
      required: ['sticker'],
    },
  },
];

export async function executeEmojiTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_emojis':
      return await listEmojis();
    case 'create_emoji':
      return await createEmoji(args);
    case 'delete_emoji':
      return await deleteEmoji(args);
    case 'rename_emoji':
      return await renameEmoji(args);
    case 'list_stickers':
      return await listStickers();
    case 'create_sticker':
      return await createSticker(args);
    case 'delete_sticker':
      return await deleteSticker(args);
    default:
      throw new Error(`Unknown emoji tool: ${name}`);
  }
}

function formatStickerFormat(format: StickerFormatType): string {
  switch (format) {
    case StickerFormatType.PNG:
      return 'PNG';
    case StickerFormatType.APNG:
      return 'APNG';
    case StickerFormatType.Lottie:
      return 'Lottie';
    case StickerFormatType.GIF:
      return 'GIF';
    default:
      return 'Unknown';
  }
}

async function listEmojis(): Promise<string> {
  const guild = await getGuild();

  const emojis = guild.emojis.cache.map(emoji => ({
    name: emoji.name,
    id: emoji.id,
    animated: emoji.animated ?? false,
    url: emoji.url,
    createdAt: emoji.createdAt?.toISOString() ?? null,
    requires_colons: emoji.requiresColons ?? true,
  }));

  return JSON.stringify({
    total: emojis.length,
    emojis,
  }, null, 2);
}

async function createEmoji(args: Record<string, unknown>): Promise<string> {
  const name = args['name'] as string;
  const imageUrl = args['imageUrl'] as string;
  const reason = args['reason'] as string | undefined;

  const guild = await getGuild();

  const emoji = await guild.emojis.create({
    attachment: imageUrl,
    name,
    reason,
  });

  return JSON.stringify({
    name: emoji.name,
    id: emoji.id,
    animated: emoji.animated ?? false,
    url: emoji.url,
    createdAt: emoji.createdAt?.toISOString() ?? null,
    requires_colons: emoji.requiresColons ?? true,
  }, null, 2);
}

async function deleteEmoji(args: Record<string, unknown>): Promise<string> {
  const emojiIdentifier = args['emoji'] as string;
  const reason = args['reason'] as string | undefined;

  const guild = await getGuild();

  const emoji = guild.emojis.cache.find(
    e => e.id === emojiIdentifier || e.name?.toLowerCase() === emojiIdentifier.toLowerCase()
  );

  if (!emoji) {
    throw new Error(`Emoji not found: ${emojiIdentifier}`);
  }

  await emoji.delete(reason);

  return JSON.stringify({
    deleted: true,
    name: emoji.name,
    id: emoji.id,
  }, null, 2);
}

async function renameEmoji(args: Record<string, unknown>): Promise<string> {
  const emojiIdentifier = args['emoji'] as string;
  const newName = args['newName'] as string;
  const reason = args['reason'] as string | undefined;

  const guild = await getGuild();

  const emoji = guild.emojis.cache.find(
    e => e.id === emojiIdentifier || e.name?.toLowerCase() === emojiIdentifier.toLowerCase()
  );

  if (!emoji) {
    throw new Error(`Emoji not found: ${emojiIdentifier}`);
  }

  const updated = await emoji.edit({ name: newName, reason });

  return JSON.stringify({
    previousName: emoji.name,
    name: updated.name,
    id: updated.id,
    animated: updated.animated ?? false,
    url: updated.url,
  }, null, 2);
}

async function listStickers(): Promise<string> {
  const guild = await getGuild();

  const fetchedStickers = await guild.stickers.fetch();

  const stickers = fetchedStickers.map(sticker => ({
    name: sticker.name,
    id: sticker.id,
    description: sticker.description,
    tags: sticker.tags,
    format: formatStickerFormat(sticker.format),
    url: sticker.url,
    createdAt: sticker.createdAt?.toISOString() ?? null,
  }));

  return JSON.stringify({
    total: stickers.length,
    stickers,
  }, null, 2);
}

async function createSticker(args: Record<string, unknown>): Promise<string> {
  const name = args['name'] as string;
  const description = args['description'] as string;
  const tags = args['tags'] as string;
  const fileUrl = args['fileUrl'] as string;
  const reason = args['reason'] as string | undefined;

  const guild = await getGuild();

  const sticker = await guild.stickers.create({
    file: fileUrl,
    name,
    description,
    tags,
    reason,
  });

  return JSON.stringify({
    name: sticker.name,
    id: sticker.id,
    description: sticker.description,
    tags: sticker.tags,
    format: formatStickerFormat(sticker.format),
    url: sticker.url,
    createdAt: sticker.createdAt?.toISOString() ?? null,
  }, null, 2);
}

async function deleteSticker(args: Record<string, unknown>): Promise<string> {
  const stickerIdentifier = args['sticker'] as string;
  const reason = args['reason'] as string | undefined;

  const guild = await getGuild();

  // Fetch stickers to ensure cache is populated
  await guild.stickers.fetch();

  const sticker = guild.stickers.cache.find(
    s => s.id === stickerIdentifier || s.name.toLowerCase() === stickerIdentifier.toLowerCase()
  );

  if (!sticker) {
    throw new Error(`Sticker not found: ${stickerIdentifier}`);
  }

  await sticker.delete(reason);

  return JSON.stringify({
    deleted: true,
    name: sticker.name,
    id: sticker.id,
  }, null, 2);
}
