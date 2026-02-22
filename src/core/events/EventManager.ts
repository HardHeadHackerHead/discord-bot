import { Client, ClientEvents } from 'discord.js';
import type { BotModule } from '../../types/module.types.js';
import type { BoundEventListener, AnyModuleEvent } from '../../types/event.types.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('EventManager');

/**
 * Manages event listener registration and cleanup for modules.
 */
export class EventManager {
  private client: Client;

  /** Bound event listeners by module */
  private boundListeners: Map<string, BoundEventListener[]> = new Map();

  /** Callback to check if module is enabled for a guild */
  private isModuleEnabled?: (moduleId: string, guildId: string) => Promise<boolean>;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Set callback to check module enabled status
   */
  setModuleEnabledChecker(
    checker: (moduleId: string, guildId: string) => Promise<boolean>
  ): void {
    this.isModuleEnabled = checker;
  }

  /**
   * Register events from a module
   */
  async registerModuleEvents(module: BotModule): Promise<void> {
    const moduleId = module.metadata.id;
    const listeners: BoundEventListener[] = [];

    for (const event of module.events) {
      // Set module ID on event
      event.moduleId = moduleId;

      // Create wrapped listener that checks module enabled status
      const wrappedListener = this.createWrappedListener(moduleId, event);

      // Register with Discord.js client
      if (event.once) {
        this.client.once(event.name, wrappedListener);
      } else {
        this.client.on(event.name, wrappedListener);
      }

      // Track for cleanup
      listeners.push({
        moduleId,
        eventName: event.name,
        listener: wrappedListener,
        once: event.once ?? false,
      });

      logger.debug(`Registered event: ${event.name} (module: ${moduleId})`);
    }

    this.boundListeners.set(moduleId, listeners);
    logger.info(`Registered ${listeners.length} event(s) from module: ${moduleId}`);
  }

  /**
   * Unregister events from a module
   */
  async unregisterModuleEvents(moduleId: string): Promise<void> {
    const listeners = this.boundListeners.get(moduleId) || [];

    for (const bound of listeners) {
      this.client.removeListener(bound.eventName, bound.listener);
      logger.debug(`Unregistered event: ${bound.eventName} (module: ${moduleId})`);
    }

    this.boundListeners.delete(moduleId);
    logger.info(`Unregistered ${listeners.length} event(s) from module: ${moduleId}`);
  }

  /**
   * Create a wrapped listener that checks module enabled status
   */
  private createWrappedListener(
    moduleId: string,
    event: AnyModuleEvent
  ): (...args: unknown[]) => void {
    return async (...args: unknown[]) => {
      try {
        // Try to extract guild ID from event arguments
        const guildId = this.extractGuildId(args);

        // Check if module is enabled for this guild
        if (guildId && this.isModuleEnabled) {
          const enabled = await this.isModuleEnabled(moduleId, guildId);
          if (!enabled) {
            logger.debug(`Event ${event.name} skipped - module ${moduleId} disabled for guild ${guildId}`);
            return;
          }
        }

        // Execute the event handler
        await event.execute(...args);

      } catch (error) {
        logger.error(`Error in event handler ${event.name} (module: ${moduleId}):`, error);
      }
    };
  }

  /**
   * Try to extract guild ID from event arguments
   * This handles common Discord.js event patterns
   */
  private extractGuildId(args: unknown[]): string | null {
    for (const arg of args) {
      if (arg && typeof arg === 'object') {
        // Direct guildId property
        if ('guildId' in arg && typeof (arg as { guildId?: string }).guildId === 'string') {
          return (arg as { guildId: string }).guildId;
        }

        // Guild object with id
        if ('guild' in arg) {
          const guild = (arg as { guild?: { id?: string } }).guild;
          if (guild?.id) {
            return guild.id;
          }
        }

        // MessageReaction has message.guild (for reaction events)
        if ('message' in arg) {
          const message = (arg as { message?: { guild?: { id?: string } } }).message;
          if (message?.guild?.id) {
            return message.guild.id;
          }
        }

        // Direct id property (for Guild objects)
        if ('id' in arg && 'name' in arg && 'memberCount' in arg) {
          return (arg as { id: string }).id;
        }
      }
    }

    return null;
  }

  /**
   * Get event count for a module
   */
  getModuleEventCount(moduleId: string): number {
    return this.boundListeners.get(moduleId)?.length || 0;
  }

  /**
   * Get total event count
   */
  getTotalEventCount(): number {
    let count = 0;
    for (const listeners of this.boundListeners.values()) {
      count += listeners.length;
    }
    return count;
  }

  /**
   * Check if a module has events registered
   */
  hasModuleEvents(moduleId: string): boolean {
    return this.boundListeners.has(moduleId);
  }
}
