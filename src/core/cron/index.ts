/**
 * Cron Service - Core scheduled task system
 *
 * Provides a simple way for modules to schedule recurring tasks.
 *
 * Usage in modules:
 *
 * ```typescript
 * import { getCronService } from '../../core/cron/index.js';
 *
 * // In module's onLoad:
 * const cron = getCronService();
 * if (cron) {
 *   cron.registerJob(this.metadata.id, {
 *     id: 'daily-cleanup',
 *     schedule: 'daily',
 *     handler: async () => {
 *       await this.myService.cleanupOldData();
 *     },
 *     description: 'Clean up old data daily',
 *   });
 * }
 *
 * // In module's onUnload:
 * const cron = getCronService();
 * if (cron) {
 *   cron.unregisterAllForModule(this.metadata.id);
 * }
 * ```
 *
 * Schedule options:
 * - 'minutely' - Every minute
 * - 'hourly' - Every hour at :00
 * - 'daily' - Every day at midnight UTC
 * - 'weekly' - Every Sunday at midnight UTC
 * - { minutes?: number, hours?: number, dayOfWeek?: number } - Custom
 *
 * Example custom schedules:
 * - { hours: 6 } - Every day at 6:00 UTC
 * - { hours: 12, minutes: 30 } - Every day at 12:30 UTC
 * - { dayOfWeek: 1, hours: 9 } - Every Monday at 9:00 UTC
 */

export {
  CronService,
  initCronService,
  getCronService,
  startCronService,
  stopCronService,
} from './CronService.js';

export type {
  CronJob,
  CronJobOptions,
  CronSchedule,
} from './CronService.js';
