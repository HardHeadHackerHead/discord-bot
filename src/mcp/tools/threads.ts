import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getGuild } from '../discord-client.js';
import { smartFindTextChannel } from './utils.js';
import { ChannelType, ThreadChannel, ThreadAutoArchiveDuration } from 'discord.js';

/**
 * Thread management tools
 */

export const threadTools: Tool[] = [
  {
    name: 'list_threads',
    description: 'List active threads in the Discord server. Optionally filter to a specific channel (fuzzy-matched).',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'Channel name or ID to filter threads to (fuzzy matched, optional)',
        },
      },
      required: [],
    },
  },
  {
    name: 'create_thread',
    description: 'Create a new thread in a channel. Channel name is fuzzy-matched. Can create a thread from an existing message or a standalone thread.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: {
          type: 'string',
          description: 'The channel name or ID to create the thread in (fuzzy matched)',
        },
        name: {
          type: 'string',
          description: 'The name for the new thread',
        },
        messageId: {
          type: 'string',
          description: 'The ID of a message to start the thread from (optional — creates a standalone thread if omitted)',
        },
        autoArchiveDuration: {
          type: 'number',
          description: 'Auto-archive duration in minutes: 60, 1440 (1 day), 4320 (3 days), or 10080 (7 days)',
        },
        reason: {
          type: 'string',
          description: 'The reason for creating this thread (shown in audit log)',
        },
      },
      required: ['channel', 'name'],
    },
  },
  {
    name: 'archive_thread',
    description: 'Archive a thread by name or ID. Optionally specify the parent channel to help find the thread.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: {
          type: 'string',
          description: 'The thread name or ID to archive',
        },
        channel: {
          type: 'string',
          description: 'The parent channel name or ID to help find the thread (fuzzy matched, optional)',
        },
      },
      required: ['thread'],
    },
  },
  {
    name: 'unarchive_thread',
    description: 'Unarchive a thread by name or ID. Optionally specify the parent channel to help find the thread.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: {
          type: 'string',
          description: 'The thread name or ID to unarchive',
        },
        channel: {
          type: 'string',
          description: 'The parent channel name or ID to help find the thread (fuzzy matched, optional)',
        },
      },
      required: ['thread'],
    },
  },
  {
    name: 'delete_thread',
    description: 'Delete a thread by name or ID.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: {
          type: 'string',
          description: 'The thread name or ID to delete',
        },
        reason: {
          type: 'string',
          description: 'The reason for deleting this thread (shown in audit log)',
        },
      },
      required: ['thread'],
    },
  },
  {
    name: 'lock_thread',
    description: 'Lock a thread to prevent new messages.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: {
          type: 'string',
          description: 'The thread name or ID to lock',
        },
        reason: {
          type: 'string',
          description: 'The reason for locking this thread (shown in audit log)',
        },
      },
      required: ['thread'],
    },
  },
  {
    name: 'unlock_thread',
    description: 'Unlock a thread to allow new messages.',
    inputSchema: {
      type: 'object',
      properties: {
        thread: {
          type: 'string',
          description: 'The thread name or ID to unlock',
        },
        reason: {
          type: 'string',
          description: 'The reason for unlocking this thread (shown in audit log)',
        },
      },
      required: ['thread'],
    },
  },
];

export async function executeThreadTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_threads':
      return await listThreads(args);
    case 'create_thread':
      return await createThread(args);
    case 'archive_thread':
      return await archiveThread(args);
    case 'unarchive_thread':
      return await unarchiveThread(args);
    case 'delete_thread':
      return await deleteThread(args);
    case 'lock_thread':
      return await lockThread(args);
    case 'unlock_thread':
      return await unlockThread(args);
    default:
      throw new Error(`Unknown thread tool: ${name}`);
  }
}

/**
 * Find a thread by name or ID from the guild's active threads
 */
async function findThread(identifier: string): Promise<ThreadChannel> {
  const guild = await getGuild();

  // Try exact ID match from guild channels cache
  const cachedChannel = guild.channels.cache.get(identifier);
  if (cachedChannel && cachedChannel.isThread()) {
    return cachedChannel as ThreadChannel;
  }

  // Fetch active threads and try matching
  const activeThreads = await guild.channels.fetchActiveThreads();

  // Try exact ID match from active threads
  const idMatch = activeThreads.threads.get(identifier);
  if (idMatch) {
    return idMatch as ThreadChannel;
  }

  // Try name match (case-insensitive)
  const identifierLower = identifier.toLowerCase();
  const nameMatch = activeThreads.threads.find(
    t => t.name.toLowerCase() === identifierLower
  );
  if (nameMatch) {
    return nameMatch as ThreadChannel;
  }

  // Try partial name match (case-insensitive)
  const partialMatch = activeThreads.threads.find(
    t => t.name.toLowerCase().includes(identifierLower) || identifierLower.includes(t.name.toLowerCase())
  );
  if (partialMatch) {
    return partialMatch as ThreadChannel;
  }

  // Not found — provide helpful error
  const threadNames = activeThreads.threads.map(t => t.name);
  let errorMsg = `Thread "${identifier}" not found.`;
  if (threadNames.length > 0) {
    errorMsg += ` Active threads: ${threadNames.join(', ')}`;
  } else {
    errorMsg += ' No active threads found in this server.';
  }

  throw new Error(errorMsg);
}

function formatThread(thread: ThreadChannel) {
  return {
    name: thread.name,
    id: thread.id,
    parentChannel: thread.parent
      ? { name: thread.parent.name, id: thread.parent.id }
      : null,
    messageCount: thread.messageCount ?? null,
    memberCount: thread.memberCount ?? null,
    archived: thread.archived ?? false,
    locked: thread.locked ?? false,
    createdAt: thread.createdAt?.toISOString() ?? null,
    archiveTimestamp: thread.archiveTimestamp
      ? new Date(thread.archiveTimestamp).toISOString()
      : null,
  };
}

async function listThreads(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();
  const channelIdentifier = args['channel'] as string | undefined;

  if (channelIdentifier) {
    // Filter to a specific channel
    const channel = await smartFindTextChannel(channelIdentifier);
    const activeThreads = await guild.channels.fetchActiveThreads();

    const channelThreads = activeThreads.threads.filter(
      t => t.parentId === channel.id
    );

    const threads = channelThreads.map(t => formatThread(t as ThreadChannel));

    return JSON.stringify({
      channel: { name: channel.name, id: channel.id },
      threadCount: threads.length,
      threads,
    }, null, 2);
  }

  // List all active threads
  const activeThreads = await guild.channels.fetchActiveThreads();
  const threads = activeThreads.threads.map(t => formatThread(t as ThreadChannel));

  return JSON.stringify({
    threadCount: threads.length,
    threads,
  }, null, 2);
}

async function createThread(args: Record<string, unknown>): Promise<string> {
  const channelIdentifier = args['channel'] as string;
  const name = args['name'] as string;
  const messageId = args['messageId'] as string | undefined;
  const autoArchiveDuration = args['autoArchiveDuration'] as number | undefined;
  const reason = args['reason'] as string | undefined;

  const channel = await smartFindTextChannel(channelIdentifier);

  // Ensure the channel supports threads (must be a text-based channel with threads)
  if (!('threads' in channel)) {
    throw new Error(`Channel "#${channel.name}" does not support threads.`);
  }

  let thread: ThreadChannel;

  if (messageId) {
    // Create thread from a message
    thread = await channel.threads.create({
      startMessage: messageId,
      name,
      autoArchiveDuration: autoArchiveDuration as ThreadAutoArchiveDuration | undefined,
      reason: reason ?? 'Created via MCP',
    });
  } else {
    // Create standalone thread
    thread = await channel.threads.create({
      name,
      autoArchiveDuration: autoArchiveDuration as ThreadAutoArchiveDuration | undefined,
      type: ChannelType.PublicThread as ChannelType.PublicThread,
      reason: reason ?? 'Created via MCP',
    } as any);
  }

  return JSON.stringify({
    success: true,
    message: `Thread "${thread.name}" created successfully in #${channel.name}`,
    thread: formatThread(thread),
  }, null, 2);
}

async function archiveThread(args: Record<string, unknown>): Promise<string> {
  const threadIdentifier = args['thread'] as string;
  const thread = await findThread(threadIdentifier);

  await thread.setArchived(true);

  return JSON.stringify({
    success: true,
    message: `Thread "${thread.name}" archived successfully`,
    thread: formatThread(thread),
  }, null, 2);
}

async function unarchiveThread(args: Record<string, unknown>): Promise<string> {
  const threadIdentifier = args['thread'] as string;
  const thread = await findThread(threadIdentifier);

  await thread.setArchived(false);

  return JSON.stringify({
    success: true,
    message: `Thread "${thread.name}" unarchived successfully`,
    thread: formatThread(thread),
  }, null, 2);
}

async function deleteThread(args: Record<string, unknown>): Promise<string> {
  const threadIdentifier = args['thread'] as string;
  const reason = args['reason'] as string | undefined;
  const thread = await findThread(threadIdentifier);

  const threadName = thread.name;
  await thread.delete(reason);

  return JSON.stringify({
    success: true,
    message: `Thread "${threadName}" deleted successfully`,
  }, null, 2);
}

async function lockThread(args: Record<string, unknown>): Promise<string> {
  const threadIdentifier = args['thread'] as string;
  const reason = args['reason'] as string | undefined;
  const thread = await findThread(threadIdentifier);

  await thread.setLocked(true, reason);

  return JSON.stringify({
    success: true,
    message: `Thread "${thread.name}" locked successfully`,
    thread: formatThread(thread),
  }, null, 2);
}

async function unlockThread(args: Record<string, unknown>): Promise<string> {
  const threadIdentifier = args['thread'] as string;
  const reason = args['reason'] as string | undefined;
  const thread = await findThread(threadIdentifier);

  await thread.setLocked(false, reason);

  return JSON.stringify({
    success: true,
    message: `Thread "${thread.name}" unlocked successfully`,
    thread: formatThread(thread),
  }, null, 2);
}
