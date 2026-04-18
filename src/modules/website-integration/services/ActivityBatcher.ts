/**
 * Activity Batcher Service
 * Batches activity events and sends them to the website in groups
 * to prevent overwhelming the website during busy periods
 */

import { Logger } from '../../../shared/utils/logger.js';
import { WebsiteApiService } from './WebsiteApiService.js';
import type { ActivityEvent, ActivityCategory } from '../types/website.types.js';

const logger = new Logger('WebsiteIntegration:Batcher');

/**
 * Options for creating an activity event
 */
export interface ActivityEventOptions {
  type: string;
  user: {
    id: string;
    username: string;
    avatar: string;
  };
  title: string;
  description?: string;
  emoji: string;
  category: ActivityCategory;
  metadata?: Record<string, unknown>;
}

interface BatcherConfig {
  batchInterval: number; // milliseconds
  maxBatchSize: number;
  maxQueueSize: number;
}

const DEFAULT_CONFIG: BatcherConfig = {
  batchInterval: 10000, // 10 seconds
  maxBatchSize: 50,
  maxQueueSize: 500,
};

export class ActivityBatcher {
  private queue: ActivityEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private recoveryTimer: NodeJS.Timeout | null = null;
  private config: BatcherConfig;
  private secret: string;
  private apiService: WebsiteApiService;
  private isRunning = false;
  private isPaused = false; // Paused due to errors
  private consecutiveFailures = 0;
  private recoveryAttempts = 0;
  private readonly MAX_FAILURES = 3;
  private readonly BASE_RECOVERY_DELAY = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_RECOVERY_DELAY = 30 * 60 * 1000; // 30 minutes

  constructor(apiService: WebsiteApiService, secret: string, config?: Partial<BatcherConfig>) {
    this.apiService = apiService;
    this.secret = secret;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Update configuration
   */
  updateConfig(secret: string, batchInterval?: number): void {
    this.secret = secret;
    if (batchInterval !== undefined) {
      this.config.batchInterval = batchInterval * 1000; // Convert seconds to ms

      // Restart timer if running
      if (this.isRunning) {
        this.stop();
        this.start();
      }
    }
  }

  /**
   * Start the batcher
   */
  start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.scheduleFlush();
    logger.info(`Activity batcher started (interval: ${this.config.batchInterval}ms)`);
  }

  /**
   * Stop the batcher
   */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.recoveryTimer) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.isRunning = false;
    this.isPaused = false;
    this.recoveryAttempts = 0;
    logger.info('Activity batcher stopped');
  }

  /**
   * Add an activity event to the queue
   */
  addEvent(options: ActivityEventOptions): void {
    // Check queue size limit
    if (this.queue.length >= this.config.maxQueueSize) {
      logger.warn(`Activity queue full (${this.config.maxQueueSize}), dropping oldest events`);
      // Remove oldest 10% of events
      const removeCount = Math.ceil(this.config.maxQueueSize * 0.1);
      this.queue.splice(0, removeCount);
    }

    const event: ActivityEvent = {
      ...options,
      timestamp: new Date().toISOString(),
    };

    this.queue.push(event);
    this.apiService.setPendingEvents(this.queue.length);

    logger.info(`Activity queued: ${options.type} for ${options.user.username} (queue size: ${this.queue.length})`);
  }

  /**
   * Get current queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Force flush all queued events immediately
   */
  async flush(): Promise<void> {
    await this.sendBatch();
  }

  /**
   * Schedule the next flush
   */
  private scheduleFlush(): void {
    if (!this.isRunning) return;

    this.timer = setTimeout(async () => {
      await this.sendBatch();
      this.scheduleFlush();
    }, this.config.batchInterval);
  }

  /**
   * Send a batch of events to the website
   */
  private async sendBatch(): Promise<void> {
    if (this.queue.length === 0) return;

    // Take up to maxBatchSize events from the queue
    const batch = this.queue.splice(0, this.config.maxBatchSize);
    this.apiService.setPendingEvents(this.queue.length);

    logger.info(`Sending batch of ${batch.length} activity events...`);

    try {
      const response = await this.apiService.sendActivityEvents({
        events: batch,
      });

      if (response.success) {
        logger.info(`Sent ${batch.length} activity events to website`);
        this.consecutiveFailures = 0; // Reset on success
      } else {
        // Put events back in queue on failure
        logger.warn(`Failed to send activity batch: ${response.error}, re-queuing ${batch.length} events`);
        this.queue.unshift(...batch);
        this.apiService.setPendingEvents(this.queue.length);
        this.handleFailure();
      }
    } catch (error) {
      // Put events back in queue on error
      logger.error('Error sending activity batch:', error);
      this.queue.unshift(...batch);
      this.apiService.setPendingEvents(this.queue.length);
      this.handleFailure();
    }
  }

  /**
   * Handle a failure - pause after too many consecutive failures, then schedule recovery
   */
  private handleFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.MAX_FAILURES) {
      this.isPaused = true;
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.isRunning = false;
      this.scheduleRecovery();
    }
  }

  /**
   * Schedule a recovery attempt with exponential backoff
   */
  private scheduleRecovery(): void {
    // Calculate delay with exponential backoff: 5min, 10min, 15min, 20min, 25min, 30min (max)
    const delay = Math.min(
      this.BASE_RECOVERY_DELAY * (this.recoveryAttempts + 1),
      this.MAX_RECOVERY_DELAY
    );
    this.recoveryAttempts++;

    const delayMinutes = Math.round(delay / 60000);
    logger.warn(`Activity batcher paused. Scheduling recovery attempt #${this.recoveryAttempts} in ${delayMinutes} minutes...`);

    this.recoveryTimer = setTimeout(() => {
      this.attemptRecovery();
    }, delay);
  }

  /**
   * Attempt to recover from paused state
   */
  private async attemptRecovery(): Promise<void> {
    logger.info(`Activity batcher attempting recovery (attempt #${this.recoveryAttempts})...`);

    // Reset failure count and try sending a batch
    this.consecutiveFailures = 0;
    this.isPaused = false;
    this.isRunning = true;

    // Try to send pending events
    await this.sendBatch();

    // If we're still running (didn't fail again), we've recovered
    if (this.isRunning && !this.isPaused) {
      logger.info('Activity batcher recovered successfully!');
      this.recoveryAttempts = 0;
      this.scheduleFlush();
    }
    // If we failed again, handleFailure() will have scheduled another recovery
  }

  /**
   * Check if paused due to errors
   */
  isPausedDueToError(): boolean {
    return this.isPaused;
  }
}
