import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('CronService');

/**
 * Cron job schedule types
 */
export type CronSchedule =
  | 'minutely'      // Every minute
  | 'hourly'        // Every hour at :00
  | 'daily'         // Every day at midnight UTC
  | 'weekly'        // Every Sunday at midnight UTC
  | { minutes?: number; hours?: number; dayOfWeek?: number }; // Custom schedule

/**
 * Cron job definition
 */
export interface CronJob {
  /** Unique identifier for the job */
  id: string;

  /** Module that registered this job */
  moduleId: string;

  /** When the job should run */
  schedule: CronSchedule;

  /** The function to execute */
  handler: () => Promise<void>;

  /** Whether the job is currently enabled */
  enabled: boolean;

  /** Last time the job ran */
  lastRun: Date | null;

  /** Next scheduled run time */
  nextRun: Date | null;

  /** Description of what the job does */
  description?: string;
}

/**
 * Options for registering a cron job
 */
export interface CronJobOptions {
  /** Unique identifier for the job */
  id: string;

  /** When the job should run */
  schedule: CronSchedule;

  /** The function to execute */
  handler: () => Promise<void>;

  /** Description of what the job does */
  description?: string;

  /** Whether to run immediately on registration (default: false) */
  runOnStart?: boolean;
}

/**
 * Core cron service for scheduling recurring tasks.
 *
 * Usage:
 * 1. Modules register cron jobs during onLoad
 * 2. CronService checks every minute which jobs need to run
 * 3. Jobs are executed and tracked
 * 4. Modules unregister jobs during onUnload
 */
export class CronService {
  private jobs: Map<string, CronJob> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private lastCheck: Date | null = null;

  /**
   * Start the cron service
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('CronService is already running');
      return;
    }

    logger.info('Starting CronService...');
    this.isRunning = true;

    // Check every minute for jobs to run
    this.checkInterval = setInterval(() => {
      this.checkAndRunJobs();
    }, 60 * 1000); // 60 seconds

    // Also run an immediate check
    this.checkAndRunJobs();

    logger.info('CronService started');
  }

  /**
   * Stop the cron service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping CronService...');

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.isRunning = false;
    logger.info('CronService stopped');
  }

  /**
   * Register a cron job
   * @param moduleId The module registering the job
   * @param options Job configuration
   * @returns The full job ID (moduleId:jobId)
   */
  registerJob(moduleId: string, options: CronJobOptions): string {
    const fullId = `${moduleId}:${options.id}`;

    if (this.jobs.has(fullId)) {
      logger.warn(`Cron job ${fullId} already exists, updating...`);
    }

    const job: CronJob = {
      id: options.id,
      moduleId,
      schedule: options.schedule,
      handler: options.handler,
      enabled: true,
      lastRun: null,
      nextRun: this.calculateNextRun(options.schedule),
      description: options.description,
    };

    this.jobs.set(fullId, job);
    logger.info(`Registered cron job: ${fullId} (${this.scheduleToString(options.schedule)})`);

    // Run immediately if requested
    if (options.runOnStart) {
      this.runJob(job).catch(err => {
        logger.error(`Error running job ${fullId} on start:`, err);
      });
    }

    return fullId;
  }

  /**
   * Unregister a cron job
   */
  unregisterJob(moduleId: string, jobId: string): boolean {
    const fullId = `${moduleId}:${jobId}`;
    const deleted = this.jobs.delete(fullId);

    if (deleted) {
      logger.info(`Unregistered cron job: ${fullId}`);
    }

    return deleted;
  }

  /**
   * Unregister all jobs for a module
   */
  unregisterAllForModule(moduleId: string): number {
    let count = 0;

    for (const [fullId, job] of this.jobs.entries()) {
      if (job.moduleId === moduleId) {
        this.jobs.delete(fullId);
        count++;
      }
    }

    if (count > 0) {
      logger.info(`Unregistered ${count} cron job(s) for module ${moduleId}`);
    }

    return count;
  }

  /**
   * Enable or disable a job
   */
  setJobEnabled(moduleId: string, jobId: string, enabled: boolean): boolean {
    const fullId = `${moduleId}:${jobId}`;
    const job = this.jobs.get(fullId);

    if (!job) {
      return false;
    }

    job.enabled = enabled;
    logger.info(`Cron job ${fullId} ${enabled ? 'enabled' : 'disabled'}`);
    return true;
  }

  /**
   * Manually trigger a job
   */
  async triggerJob(moduleId: string, jobId: string): Promise<boolean> {
    const fullId = `${moduleId}:${jobId}`;
    const job = this.jobs.get(fullId);

    if (!job) {
      logger.warn(`Cannot trigger job ${fullId}: not found`);
      return false;
    }

    await this.runJob(job);
    return true;
  }

  /**
   * Get all registered jobs
   */
  getJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  /**
   * Get jobs for a specific module
   */
  getJobsForModule(moduleId: string): CronJob[] {
    return Array.from(this.jobs.values()).filter(j => j.moduleId === moduleId);
  }

  /**
   * Get a specific job
   */
  getJob(moduleId: string, jobId: string): CronJob | undefined {
    return this.jobs.get(`${moduleId}:${jobId}`);
  }

  /**
   * Check which jobs need to run and execute them
   */
  private async checkAndRunJobs(): Promise<void> {
    const now = new Date();
    this.lastCheck = now;

    for (const [fullId, job] of this.jobs.entries()) {
      if (!job.enabled) continue;
      if (!job.nextRun) continue;

      // Check if job should run
      if (now >= job.nextRun) {
        // Run the job (don't await - run in parallel)
        this.runJob(job).catch(err => {
          logger.error(`Error running cron job ${fullId}:`, err);
        });
      }
    }
  }

  /**
   * Execute a job
   */
  private async runJob(job: CronJob): Promise<void> {
    const fullId = `${job.moduleId}:${job.id}`;
    logger.debug(`Running cron job: ${fullId}`);

    const startTime = Date.now();

    try {
      await job.handler();

      const duration = Date.now() - startTime;
      logger.info(`Cron job ${fullId} completed in ${duration}ms`);
    } catch (error) {
      logger.error(`Cron job ${fullId} failed:`, error);
    }

    // Update timing
    job.lastRun = new Date();
    job.nextRun = this.calculateNextRun(job.schedule);
  }

  /**
   * Calculate the next run time for a schedule
   */
  private calculateNextRun(schedule: CronSchedule): Date {
    const now = new Date();
    const next = new Date(now);

    // Reset seconds and milliseconds
    next.setSeconds(0);
    next.setMilliseconds(0);

    if (schedule === 'minutely') {
      // Next minute
      next.setMinutes(next.getMinutes() + 1);
    } else if (schedule === 'hourly') {
      // Next hour at :00
      next.setMinutes(0);
      next.setHours(next.getHours() + 1);
    } else if (schedule === 'daily') {
      // Tomorrow at midnight UTC
      next.setUTCHours(0, 0, 0, 0);
      next.setUTCDate(next.getUTCDate() + 1);
    } else if (schedule === 'weekly') {
      // Next Sunday at midnight UTC
      next.setUTCHours(0, 0, 0, 0);
      const daysUntilSunday = (7 - next.getUTCDay()) % 7 || 7;
      next.setUTCDate(next.getUTCDate() + daysUntilSunday);
    } else {
      // Custom schedule
      const { minutes, hours, dayOfWeek } = schedule;

      if (minutes !== undefined) {
        next.setMinutes(minutes);
        if (next <= now) {
          next.setHours(next.getHours() + 1);
        }
      }

      if (hours !== undefined) {
        next.setUTCHours(hours);
        next.setMinutes(minutes ?? 0);
        if (next <= now) {
          next.setUTCDate(next.getUTCDate() + 1);
        }
      }

      if (dayOfWeek !== undefined) {
        next.setUTCHours(hours ?? 0);
        next.setMinutes(minutes ?? 0);
        const currentDay = next.getUTCDay();
        const daysUntil = (dayOfWeek - currentDay + 7) % 7 || 7;
        if (next <= now || daysUntil === 0) {
          next.setUTCDate(next.getUTCDate() + (daysUntil || 7));
        }
      }
    }

    return next;
  }

  /**
   * Convert schedule to human-readable string
   */
  private scheduleToString(schedule: CronSchedule): string {
    if (typeof schedule === 'string') {
      return schedule;
    }

    const parts: string[] = [];
    if (schedule.minutes !== undefined) parts.push(`min:${schedule.minutes}`);
    if (schedule.hours !== undefined) parts.push(`hour:${schedule.hours}`);
    if (schedule.dayOfWeek !== undefined) {
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      parts.push(`day:${days[schedule.dayOfWeek]}`);
    }
    return parts.join(', ') || 'custom';
  }

  /**
   * Get service status
   */
  getStatus(): { running: boolean; jobCount: number; lastCheck: Date | null } {
    return {
      running: this.isRunning,
      jobCount: this.jobs.size,
      lastCheck: this.lastCheck,
    };
  }
}

// Singleton instance
let cronService: CronService | null = null;

/**
 * Initialize the cron service
 */
export function initCronService(): CronService {
  if (!cronService) {
    cronService = new CronService();
  }
  return cronService;
}

/**
 * Get the cron service instance
 */
export function getCronService(): CronService | null {
  return cronService;
}

/**
 * Start the cron service
 */
export function startCronService(): void {
  if (cronService) {
    cronService.start();
  }
}

/**
 * Stop the cron service
 */
export function stopCronService(): void {
  if (cronService) {
    cronService.stop();
  }
}
