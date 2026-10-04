import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as resetsCommand, setResetsService } from './commands/resets.js';
import { ResetsService } from './services/ResetsService.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Resets');

/**
 * Resets Module - Claude Code and ChatGPT Codex usage limit resets
 *
 * /resets claude|codex shows the latest resets (data from claude-resets.com
 * and codex-resets.com). /resets setchannel enables live alerts: the module
 * polls both sites and posts as soon as a new reset appears.
 */
export class ResetsModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'resets',
    name: 'Resets',
    description: 'Tracks Claude Code and ChatGPT Codex usage limit resets, with live alerts',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 50,
  };

  readonly migrationsPath = './migrations';

  private service: ResetsService | null = null;

  constructor() {
    super();
    this.commands = [resetsCommand];
    this.events = [];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    this.service = new ResetsService(context.db);
    setResetsService(this.service);
    this.service.start(context.client);

    logger.info('Resets module loaded');
  }

  async onUnload(): Promise<void> {
    this.service?.stop();
    this.service = null;
    await super.onUnload();
    logger.info('Resets module unloaded');
  }
}
