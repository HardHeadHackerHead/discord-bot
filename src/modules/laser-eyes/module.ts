import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as laserEyesCommand, setService as setCommandService } from './commands/lasereyes.js';
import { messageCreateEvent, setService as setEventService } from './events/messageCreate.js';
import { LaserEyesService } from './services/LaserEyesService.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('LaserEyes');

/**
 * Laser Eyes — adds glowing red laser eyes to any avatar or image.
 *
 * Triggers:
 *  - /lasereyes [user] [image]   — slash command
 *  - @BotMention + image/keyword — natural-language trigger
 *
 * Uses OpenCV.js (WASM) with Haar cascades for face + eye detection.
 * Composites a laser PNG from assets/laser-eyes/ onto both detected eyes.
 * If eyes can't be detected, replies with a clear message — no fallback.
 */
export class LaserEyesModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'laser-eyes',
    name: 'Laser Eyes',
    description: 'Zap avatars and images with glowing red laser eyes',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  // No database tables — no migrations.
  readonly migrationsPath = null;

  private service: LaserEyesService | null = null;

  constructor() {
    super();
    this.commands = [laserEyesCommand];
    this.events = [messageCreateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    this.service = new LaserEyesService();
    setCommandService(this.service);
    setEventService(this.service);

    if (!this.service.isAvailable()) {
      logger.warn('Laser Eyes loaded but Haar cascades are missing from assets/opencv-cascades/');
    } else {
      logger.info('Laser Eyes module loaded');
    }
  }

  async onUnload(): Promise<void> {
    this.service = null;
    await super.onUnload();
    logger.info('Laser Eyes module unloaded');
  }
}
