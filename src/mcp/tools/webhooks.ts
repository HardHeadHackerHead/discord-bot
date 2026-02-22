import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getGuild, getClient } from '../discord-client.js';
import { smartFindTextChannel } from './utils.js';
import { TextChannel } from 'discord.js';

/**
 * Webhook management tools
 */

export const webhookTools: Tool[] = [
  {
    name: 'list_webhooks',
    description: 'List all webhooks in the server, optionally filtered to a specific channel. Channel name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name or ID to filter webhooks by (fuzzy matched, optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'create_webhook',
    description: 'Create a new webhook for a channel. Channel name is fuzzy-matched.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'The channel name or ID to create the webhook in (fuzzy matched)',
        },
        name: {
          type: 'string',
          description: 'The name for the webhook',
        },
        avatarUrl: {
          type: 'string',
          description: 'URL of the avatar image for the webhook (optional)',
        },
        reason: {
          type: 'string',
          description: 'The reason for creating this webhook (shown in audit log)',
        },
      },
      required: ['channel', 'name'],
    },
  },
  {
    name: 'delete_webhook',
    description: 'Delete a webhook by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        webhookId: {
          type: 'string',
          description: 'The ID of the webhook to delete',
        },
        reason: {
          type: 'string',
          description: 'The reason for deleting this webhook (shown in audit log)',
        },
      },
      required: ['webhookId'],
    },
  },
  {
    name: 'send_webhook_message',
    description: 'Send a message via a webhook. Can optionally override the display name and avatar.',
    inputSchema: {
      type: 'object',
      properties: {
        webhookId: {
          type: 'string',
          description: 'The ID of the webhook to send the message through',
        },
        content: {
          type: 'string',
          description: 'The message content to send',
        },
        username: {
          type: 'string',
          description: 'Override the webhook display name for this message (optional)',
        },
        avatarUrl: {
          type: 'string',
          description: 'Override the webhook avatar URL for this message (optional)',
        },
      },
      required: ['webhookId', 'content'],
    },
  },
];

export async function executeWebhookTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_webhooks':
      return await listWebhooks(args);
    case 'create_webhook':
      return await createWebhook(args);
    case 'delete_webhook':
      return await deleteWebhook(args);
    case 'send_webhook_message':
      return await sendWebhookMessage(args);
    default:
      throw new Error(`Unknown webhook tool: ${name}`);
  }
}

async function listWebhooks(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const channelIdentifier = args['channel'] as string | undefined;

  let webhooks;

  if (channelIdentifier) {
    const channel = await smartFindTextChannel(channelIdentifier);
    if (!channel.isTextBased()) {
      throw new Error(`Channel "${channelIdentifier}" is not a text-based channel and cannot have webhooks.`);
    }
    webhooks = await (channel as TextChannel).fetchWebhooks();
  } else {
    webhooks = await guild.fetchWebhooks();
  }

  const result = webhooks.map(wh => {
    const channelObj = guild.channels.cache.get(wh.channelId);
    return {
      id: wh.id,
      name: wh.name,
      channelId: wh.channelId,
      channelName: channelObj?.name ?? null,
      url: wh.url,
      creator: wh.owner ? { id: wh.owner.id, username: wh.owner.username } : null,
      avatar: wh.avatar,
      createdAt: wh.createdAt?.toISOString() ?? null,
    };
  });

  return JSON.stringify(result, null, 2);
}

async function createWebhook(args: Record<string, unknown>): Promise<string> {
  const channelIdentifier = args['channel'] as string;
  const name = args['name'] as string;
  const avatarUrl = args['avatarUrl'] as string | undefined;
  const reason = args['reason'] as string | undefined;

  const channel = await smartFindTextChannel(channelIdentifier);
  if (!channel.isTextBased()) {
    throw new Error(`Channel "${channelIdentifier}" is not a text-based channel and cannot have webhooks.`);
  }

  const webhook = await (channel as TextChannel).createWebhook({
    name,
    avatar: avatarUrl,
    reason: reason ?? 'Created via MCP',
  });

  return JSON.stringify({
    success: true,
    message: `Webhook "${webhook.name}" created successfully`,
    webhook: {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      token: webhook.token,
      channelId: webhook.channelId,
      channelName: channel.name,
    },
  }, null, 2);
}

async function deleteWebhook(args: Record<string, unknown>): Promise<string> {
  const webhookId = args['webhookId'] as string;
  const reason = args['reason'] as string | undefined;

  const client = getClient();
  const webhook = await client.fetchWebhook(webhookId);

  const webhookName = webhook.name;
  await webhook.delete(reason ?? 'Deleted via MCP');

  return JSON.stringify({
    success: true,
    message: `Webhook "${webhookName}" deleted successfully`,
  }, null, 2);
}

async function sendWebhookMessage(args: Record<string, unknown>): Promise<string> {
  const webhookId = args['webhookId'] as string;
  const content = args['content'] as string;
  const username = args['username'] as string | undefined;
  const avatarUrl = args['avatarUrl'] as string | undefined;

  const client = getClient();
  const webhook = await client.fetchWebhook(webhookId);

  const message = await webhook.send({
    content,
    username,
    avatarURL: avatarUrl,
  });

  return JSON.stringify({
    success: true,
    message: {
      id: message.id,
      content: message.content,
      channelId: message.channelId,
    },
  }, null, 2);
}
