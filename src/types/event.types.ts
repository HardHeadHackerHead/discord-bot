import type { ClientEvents } from 'discord.js';

/**
 * Event handler function type
 */
export type EventHandler<K extends keyof ClientEvents> = (
  ...args: ClientEvents[K]
) => Promise<void> | void;

/**
 * Module event listener definition
 */
export interface ModuleEvent<K extends keyof ClientEvents = keyof ClientEvents> {
  /** Event name from Discord.js ClientEvents */
  name: K;

  /** Whether to listen only once */
  once?: boolean;

  /** Event handler function */
  execute: EventHandler<K>;

  /** Module this event belongs to (set automatically) */
  moduleId?: string;
}

/**
 * Helper to define an event listener with type safety
 * Returns AnyModuleEvent for storage in module.events arrays
 */
export function defineEvent<K extends keyof ClientEvents>(
  name: K,
  execute: EventHandler<K>,
  options?: { once?: boolean }
): AnyModuleEvent {
  return {
    name,
    execute: execute as (...args: unknown[]) => Promise<void> | void,
    once: options?.once ?? false,
  };
}

/**
 * Common Discord.js events for quick reference
 */
export type CommonEvents =
  | 'ready'
  | 'interactionCreate'
  | 'messageCreate'
  | 'messageDelete'
  | 'messageUpdate'
  | 'guildCreate'
  | 'guildDelete'
  | 'guildMemberAdd'
  | 'guildMemberRemove'
  | 'guildMemberUpdate'
  | 'voiceStateUpdate'
  | 'messageReactionAdd'
  | 'messageReactionRemove'
  | 'channelCreate'
  | 'channelDelete'
  | 'channelUpdate';

/**
 * Wrapper for bound event listeners (used for cleanup)
 */
export interface BoundEventListener {
  moduleId: string;
  eventName: keyof ClientEvents;
  listener: (...args: unknown[]) => void;
  once: boolean;
}

/**
 * Generic module event for storage in arrays (loses specific type info)
 * Use this when storing events in module.events arrays
 */
export interface AnyModuleEvent {
  name: keyof ClientEvents;
  once?: boolean;
  execute: (...args: unknown[]) => Promise<void> | void;
  moduleId?: string;
}
