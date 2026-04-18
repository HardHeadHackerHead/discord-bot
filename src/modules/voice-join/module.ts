import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as joinCommand } from './commands/join.js';
import { Logger } from '../../shared/utils/logger.js';
import { getVoiceConnection } from '@discordjs/voice';

const logger = new Logger('VoiceJoin');

/**
 * Voice Join Module - Makes the bot join voice channels for testing
 */
export class VoiceJoinModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'voice-join',
    name: 'Voice Join',
    description: 'Makes the bot join voice channels for testing purposes',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 100,
  };

  constructor() {
    super();
    this.commands = [joinCommand];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);
    logger.info('Voice Join module loaded');
  }

  async onUnload(): Promise<void> {
    // Disconnect from all voice channels
    if (this.context) {
      for (const guild of this.context.client.guilds.cache.values()) {
        const connection = getVoiceConnection(guild.id);
        if (connection) {
          connection.destroy();
          logger.debug(`Disconnected from voice in ${guild.name}`);
        }
      }
    }
    logger.info('Voice Join module unloaded');
  }
}
