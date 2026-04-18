import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as recordCommand } from './commands/record.js';
import { Logger } from '../../shared/utils/logger.js';
import { destroyVoiceRecorder } from '../../core/voice/VoiceRecorder.js';

const logger = new Logger('TestRecording');

/**
 * Test Recording Module - EXPERIMENTAL
 *
 * Tests voice recording functionality. If this doesn't work properly,
 * you can safely disable or delete this module.
 */
export class TestRecordingModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'test-recording',
    name: 'Test Recording',
    description: 'Experimental voice recording test module',
    version: '0.1.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: false, // Hidden from users since it's experimental
    dependencies: [],
    priority: 100,
  };

  constructor() {
    super();
    this.commands = [recordCommand];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);
    logger.info('Test Recording module loaded (EXPERIMENTAL)');
  }

  async onUnload(): Promise<void> {
    // Clean up any active recordings
    destroyVoiceRecorder();
    logger.info('Test Recording module unloaded');
  }
}
