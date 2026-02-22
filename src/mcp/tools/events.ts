import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { getGuild } from '../discord-client.js';
import { smartFindChannel } from './utils.js';
import { GuildScheduledEventEntityType, GuildScheduledEventPrivacyLevel, GuildScheduledEventStatus } from 'discord.js';

/**
 * Scheduled event management tools
 */

export const eventTools: Tool[] = [
  {
    name: 'list_events',
    description: 'List all scheduled events in the Discord server. Returns event details including name, time, status, and type.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'create_event',
    description: 'Create a new scheduled event in the Discord server. Supports voice, stage, and external event types.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the event',
        },
        description: {
          type: 'string',
          description: 'A description for the event',
        },
        startTime: {
          type: 'string',
          description: 'The start time in ISO 8601 format (e.g., "2025-03-15T18:00:00Z")',
        },
        endTime: {
          type: 'string',
          description: 'The end time in ISO 8601 format. Required for external events.',
        },
        type: {
          type: 'string',
          enum: ['voice', 'stage', 'external'],
          description: 'The type of event: "voice" (voice channel), "stage" (stage channel), or "external" (external location)',
        },
        channel: {
          type: 'string',
          description: 'The channel name or ID for voice/stage events (fuzzy matched). Required for voice and stage types.',
        },
        location: {
          type: 'string',
          description: 'The location for external events. Required for external type.',
        },
        image: {
          type: 'string',
          description: 'URL of the cover image for the event',
        },
      },
      required: ['name', 'startTime', 'type'],
    },
  },
  {
    name: 'edit_event',
    description: 'Modify an existing scheduled event. You can update its name, description, times, or status.',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'The ID of the scheduled event to edit',
        },
        name: {
          type: 'string',
          description: 'New name for the event',
        },
        description: {
          type: 'string',
          description: 'New description for the event',
        },
        startTime: {
          type: 'string',
          description: 'New start time in ISO 8601 format',
        },
        endTime: {
          type: 'string',
          description: 'New end time in ISO 8601 format',
        },
        status: {
          type: 'string',
          enum: ['scheduled', 'active', 'completed', 'canceled'],
          description: 'New status for the event',
        },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'delete_event',
    description: 'Delete a scheduled event from the Discord server.',
    inputSchema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'The ID of the scheduled event to delete',
        },
      },
      required: ['eventId'],
    },
  },
];

export async function executeEventTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case 'list_events':
      return await listEvents();
    case 'create_event':
      return await createEvent(args);
    case 'edit_event':
      return await editEvent(args);
    case 'delete_event':
      return await deleteEvent(args);
    default:
      throw new Error(`Unknown event tool: ${name}`);
  }
}

function mapStatusToString(status: GuildScheduledEventStatus): string {
  switch (status) {
    case GuildScheduledEventStatus.Scheduled:
      return 'scheduled';
    case GuildScheduledEventStatus.Active:
      return 'active';
    case GuildScheduledEventStatus.Completed:
      return 'completed';
    case GuildScheduledEventStatus.Canceled:
      return 'canceled';
    default:
      return 'unknown';
  }
}

function mapEntityTypeToString(entityType: GuildScheduledEventEntityType): string {
  switch (entityType) {
    case GuildScheduledEventEntityType.StageInstance:
      return 'stage';
    case GuildScheduledEventEntityType.Voice:
      return 'voice';
    case GuildScheduledEventEntityType.External:
      return 'external';
    default:
      return 'unknown';
  }
}

function mapStringToEntityType(type: string): GuildScheduledEventEntityType {
  switch (type) {
    case 'voice':
      return GuildScheduledEventEntityType.Voice;
    case 'stage':
      return GuildScheduledEventEntityType.StageInstance;
    case 'external':
      return GuildScheduledEventEntityType.External;
    default:
      throw new Error(`Invalid event type: "${type}". Must be "voice", "stage", or "external".`);
  }
}

function mapStringToStatus(status: string): GuildScheduledEventStatus {
  switch (status) {
    case 'scheduled':
      return GuildScheduledEventStatus.Scheduled;
    case 'active':
      return GuildScheduledEventStatus.Active;
    case 'completed':
      return GuildScheduledEventStatus.Completed;
    case 'canceled':
      return GuildScheduledEventStatus.Canceled;
    default:
      throw new Error(`Invalid event status: "${status}". Must be "scheduled", "active", "completed", or "canceled".`);
  }
}

async function listEvents(): Promise<string> {
  const guild = await getGuild();
  const events = await guild.scheduledEvents.fetch();

  const result = events.map(event => ({
    id: event.id,
    name: event.name,
    description: event.description,
    scheduledStartTime: event.scheduledStartTimestamp ? new Date(event.scheduledStartTimestamp).toISOString() : null,
    scheduledEndTime: event.scheduledEndTimestamp ? new Date(event.scheduledEndTimestamp).toISOString() : null,
    status: mapStatusToString(event.status),
    entityType: mapEntityTypeToString(event.entityType),
    channel: event.channel ? { name: event.channel.name, id: event.channel.id } : null,
    location: event.entityMetadata?.location ?? null,
    creator: event.creator ? { id: event.creator.id, username: event.creator.username } : null,
    userCount: event.userCount,
    image: event.coverImageURL() ?? null,
  }));

  return JSON.stringify({
    totalEvents: result.length,
    events: result,
  }, null, 2);
}

async function createEvent(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();

  const name = args['name'] as string;
  const description = args['description'] as string | undefined;
  const startTime = args['startTime'] as string;
  const endTime = args['endTime'] as string | undefined;
  const type = args['type'] as string;
  const channel = args['channel'] as string | undefined;
  const location = args['location'] as string | undefined;
  const image = args['image'] as string | undefined;

  const entityType = mapStringToEntityType(type);

  // Validate requirements based on type
  if ((type === 'voice' || type === 'stage') && !channel) {
    throw new Error(`A channel is required for ${type} events.`);
  }

  if (type === 'external' && !location) {
    throw new Error('A location is required for external events.');
  }

  if (type === 'external' && !endTime) {
    throw new Error('An end time is required for external events.');
  }

  // Resolve channel for voice/stage events
  let channelId: string | undefined;
  if (channel) {
    const resolved = await smartFindChannel(channel);
    channelId = resolved.id;
  }

  const eventData: Record<string, unknown> = {
    name,
    description,
    scheduledStartTime: new Date(startTime),
    scheduledEndTime: endTime ? new Date(endTime) : undefined,
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType,
    image,
  };

  if (type === 'external') {
    eventData['entityMetadata'] = { location };
  } else {
    eventData['channel'] = channelId;
  }

  const event = await guild.scheduledEvents.create(eventData as any);

  return JSON.stringify({
    success: true,
    message: `Event "${event.name}" created successfully`,
    event: {
      id: event.id,
      name: event.name,
      description: event.description,
      scheduledStartTime: event.scheduledStartTimestamp ? new Date(event.scheduledStartTimestamp).toISOString() : null,
      scheduledEndTime: event.scheduledEndTimestamp ? new Date(event.scheduledEndTimestamp).toISOString() : null,
      status: mapStatusToString(event.status),
      entityType: mapEntityTypeToString(event.entityType),
      channel: event.channel ? { name: event.channel.name, id: event.channel.id } : null,
      location: event.entityMetadata?.location ?? null,
    },
  }, null, 2);
}

async function editEvent(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();

  const eventId = args['eventId'] as string;
  const event = await guild.scheduledEvents.fetch(eventId);

  if (!event) {
    throw new Error(`Scheduled event with ID "${eventId}" not found.`);
  }

  const updates: Record<string, unknown> = {};

  if (args['name'] !== undefined) updates['name'] = args['name'] as string;
  if (args['description'] !== undefined) updates['description'] = args['description'] as string;
  if (args['startTime'] !== undefined) updates['scheduledStartTime'] = new Date(args['startTime'] as string);
  if (args['endTime'] !== undefined) updates['scheduledEndTime'] = new Date(args['endTime'] as string);
  if (args['status'] !== undefined) updates['status'] = mapStringToStatus(args['status'] as string);

  const updatedEvent = await event.edit(updates as any);

  return JSON.stringify({
    success: true,
    message: `Event "${updatedEvent.name}" updated successfully`,
    event: {
      id: updatedEvent.id,
      name: updatedEvent.name,
      description: updatedEvent.description,
      scheduledStartTime: updatedEvent.scheduledStartTimestamp ? new Date(updatedEvent.scheduledStartTimestamp).toISOString() : null,
      scheduledEndTime: updatedEvent.scheduledEndTimestamp ? new Date(updatedEvent.scheduledEndTimestamp).toISOString() : null,
      status: mapStatusToString(updatedEvent.status),
      entityType: mapEntityTypeToString(updatedEvent.entityType),
    },
  }, null, 2);
}

async function deleteEvent(args: Record<string, unknown>): Promise<string> {
  const guild = await getGuild();

  const eventId = args['eventId'] as string;
  const event = await guild.scheduledEvents.fetch(eventId);

  if (!event) {
    throw new Error(`Scheduled event with ID "${eventId}" not found.`);
  }

  const eventName = event.name;
  await event.delete();

  return JSON.stringify({
    success: true,
    message: `Event "${eventName}" deleted successfully`,
  }, null, 2);
}
