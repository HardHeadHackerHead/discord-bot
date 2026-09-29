import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as deafsyncCommand, setDeafenSyncService as setCommandService } from './commands/deafsync.js';
import { voiceStateUpdateEvent, setDeafenSyncService as setEventService } from './events/voiceStateUpdate.js';
import { DeafenSyncService } from './services/DeafenSyncService.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('DeafenSync');

/**
 * Deafen Sync Module - Counters "fake deafen" clients
 *
 * For users added with /deafsync add, deafening in their client triggers a
 * real server deafen, and undeafening lifts it. Server deafens applied by
 * someone else are never lifted by this module.
 */
export class DeafenSyncModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'deafen-sync',
    name: 'Deafen Sync',
    description: 'Server-deafens selected users whenever their client is deafened',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private service: DeafenSyncService | null = null;

  constructor() {
    super();
    this.commands = [deafsyncCommand];
    this.events = [voiceStateUpdateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    this.service = new DeafenSyncService(context.db);
    setCommandService(this.service);
    setEventService(this.service);

    await this.service.loadAll();

    // Catch up on anyone who toggled deafen while the bot was offline
    await this.service.syncAll(context.client);

    logger.info('Deafen Sync module loaded');
  }

  async onUnload(): Promise<void> {
    this.service = null;
    await super.onUnload();
    logger.info('Deafen Sync module unloaded');
  }
}
