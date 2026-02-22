import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('ModuleEventBus');

/**
 * Event payload that includes the source module
 */
export interface ModuleEventPayload<T = unknown> {
  /** The module that emitted the event */
  sourceModule: string;
  /** The event data */
  data: T;
  /** Timestamp when the event was emitted */
  timestamp: Date;
}

/**
 * Event handler function type
 */
export type ModuleEventHandler<T = unknown> = (
  payload: ModuleEventPayload<T>
) => void | Promise<void>;

/**
 * Subscription handle for unsubscribing
 */
export interface EventSubscription {
  /** Unsubscribe from the event */
  unsubscribe(): void;
}

/**
 * Internal subscription tracking
 */
interface Subscription {
  moduleId: string;
  eventName: string;
  handler: ModuleEventHandler;
}

/**
 * Central event bus for inter-module communication.
 *
 * Modules can emit events that other modules can listen to.
 * This enables loose coupling between modules - they don't need
 * to know about each other directly.
 *
 * Event naming convention: `module-id:event-name`
 * Examples:
 *   - `voice-tracking:session-ended` - Voice session ended
 *   - `points:points-awarded` - Points were awarded
 *   - `user-tracking:user-joined` - User joined a guild
 *
 * Usage:
 * ```typescript
 * // In voice-tracking module
 * moduleEventBus.emit('voice-tracking:session-ended', 'voice-tracking', {
 *   userId: '123',
 *   guildId: '456',
 *   duration: 3600 // seconds
 * });
 *
 * // In points module
 * moduleEventBus.on('voice-tracking:session-ended', 'points', async (payload) => {
 *   const { userId, guildId, duration } = payload.data;
 *   // Award points based on duration
 * });
 * ```
 */
export class ModuleEventBus {
  /** Map of event name to handlers */
  private handlers: Map<string, Set<Subscription>> = new Map();

  /** Map of module ID to its subscriptions (for cleanup) */
  private moduleSubscriptions: Map<string, Set<Subscription>> = new Map();

  /**
   * Subscribe to an event
   * @param eventName The event to listen for (e.g., 'voice-tracking:session-ended')
   * @param subscriberModuleId The module that's subscribing
   * @param handler The callback function
   * @returns Subscription handle for unsubscribing
   */
  on<T = unknown>(
    eventName: string,
    subscriberModuleId: string,
    handler: ModuleEventHandler<T>
  ): EventSubscription {
    const subscription: Subscription = {
      moduleId: subscriberModuleId,
      eventName,
      handler: handler as ModuleEventHandler,
    };

    // Add to event handlers
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set());
    }
    this.handlers.get(eventName)!.add(subscription);

    // Track by module for cleanup
    if (!this.moduleSubscriptions.has(subscriberModuleId)) {
      this.moduleSubscriptions.set(subscriberModuleId, new Set());
    }
    this.moduleSubscriptions.get(subscriberModuleId)!.add(subscription);

    logger.debug(`Module ${subscriberModuleId} subscribed to event: ${eventName}`);

    return {
      unsubscribe: () => this.removeSubscription(subscription),
    };
  }

  /**
   * Subscribe to an event once (auto-unsubscribes after first call)
   */
  once<T = unknown>(
    eventName: string,
    subscriberModuleId: string,
    handler: ModuleEventHandler<T>
  ): EventSubscription {
    const subscription = this.on<T>(eventName, subscriberModuleId, async (payload) => {
      subscription.unsubscribe();
      await handler(payload);
    });
    return subscription;
  }

  /**
   * Emit an event
   * @param eventName The event name (e.g., 'voice-tracking:session-ended')
   * @param emitterModuleId The module emitting the event
   * @param data The event data
   */
  async emit<T = unknown>(
    eventName: string,
    emitterModuleId: string,
    data: T
  ): Promise<void> {
    const handlers = this.handlers.get(eventName);

    if (!handlers || handlers.size === 0) {
      logger.debug(`Event ${eventName} emitted but no subscribers`);
      return;
    }

    const payload: ModuleEventPayload<T> = {
      sourceModule: emitterModuleId,
      data,
      timestamp: new Date(),
    };

    logger.debug(
      `Event ${eventName} emitted by ${emitterModuleId}, ` +
      `${handlers.size} subscriber(s)`
    );

    // Execute all handlers
    const promises: Promise<void>[] = [];

    for (const subscription of handlers) {
      try {
        const result = subscription.handler(payload as ModuleEventPayload);
        if (result instanceof Promise) {
          promises.push(
            result.catch((error) => {
              logger.error(
                `Error in event handler for ${eventName} ` +
                `(subscriber: ${subscription.moduleId}):`,
                error
              );
            })
          );
        }
      } catch (error) {
        logger.error(
          `Error in event handler for ${eventName} ` +
          `(subscriber: ${subscription.moduleId}):`,
          error
        );
      }
    }

    // Wait for all async handlers to complete
    if (promises.length > 0) {
      await Promise.all(promises);
    }
  }

  /**
   * Emit an event without waiting for handlers (fire-and-forget)
   */
  emitAsync<T = unknown>(
    eventName: string,
    emitterModuleId: string,
    data: T
  ): void {
    this.emit(eventName, emitterModuleId, data).catch((error) => {
      logger.error(`Error emitting event ${eventName}:`, error);
    });
  }

  /**
   * Remove a specific subscription
   */
  private removeSubscription(subscription: Subscription): void {
    // Remove from event handlers
    const handlers = this.handlers.get(subscription.eventName);
    if (handlers) {
      handlers.delete(subscription);
      if (handlers.size === 0) {
        this.handlers.delete(subscription.eventName);
      }
    }

    // Remove from module tracking
    const moduleSubscriptions = this.moduleSubscriptions.get(subscription.moduleId);
    if (moduleSubscriptions) {
      moduleSubscriptions.delete(subscription);
      if (moduleSubscriptions.size === 0) {
        this.moduleSubscriptions.delete(subscription.moduleId);
      }
    }

    logger.debug(
      `Module ${subscription.moduleId} unsubscribed from event: ${subscription.eventName}`
    );
  }

  /**
   * Remove all subscriptions for a module (called when module unloads)
   */
  unsubscribeAll(moduleId: string): void {
    const subscriptions = this.moduleSubscriptions.get(moduleId);
    if (!subscriptions) return;

    for (const subscription of subscriptions) {
      const handlers = this.handlers.get(subscription.eventName);
      if (handlers) {
        handlers.delete(subscription);
        if (handlers.size === 0) {
          this.handlers.delete(subscription.eventName);
        }
      }
    }

    this.moduleSubscriptions.delete(moduleId);
    logger.debug(`Removed all subscriptions for module: ${moduleId}`);
  }

  /**
   * Check if any module is subscribed to an event
   */
  hasSubscribers(eventName: string): boolean {
    const handlers = this.handlers.get(eventName);
    return handlers !== undefined && handlers.size > 0;
  }

  /**
   * Get the number of subscribers for an event
   */
  getSubscriberCount(eventName: string): number {
    return this.handlers.get(eventName)?.size ?? 0;
  }

  /**
   * Get all events a module is subscribed to
   */
  getModuleSubscriptions(moduleId: string): string[] {
    const subscriptions = this.moduleSubscriptions.get(moduleId);
    if (!subscriptions) return [];
    return Array.from(new Set([...subscriptions].map(s => s.eventName)));
  }

  /**
   * Clear all subscriptions (for testing or shutdown)
   */
  clear(): void {
    this.handlers.clear();
    this.moduleSubscriptions.clear();
    logger.debug('Event bus cleared');
  }
}

/**
 * Singleton instance
 */
export const moduleEventBus = new ModuleEventBus();
