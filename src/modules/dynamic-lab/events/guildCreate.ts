import { Guild } from 'discord.js';
import { AnyModuleEvent } from '../../../types/event.types.js';
import { LabSetupService } from '../services/LabSetupService.js';
import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('DynamicLab:GuildCreate');

let labSetupService: LabSetupService | null = null;

export function setLabSetupService(service: LabSetupService): void {
  labSetupService = service;
}

export const guildCreateEvent: AnyModuleEvent = {
  name: 'guildCreate',
  once: false,

  async execute(...args: unknown[]): Promise<void> {
    const guild = args[0] as Guild;

    if (!labSetupService) {
      logger.warn('LabSetupService not initialized');
      return;
    }

    logger.info(`Bot joined new guild: ${guild.name}`);

    // Set up the Get Lab Here channel for the new guild
    try {
      await labSetupService.ensureGetLabChannel(guild);
    } catch (error) {
      logger.error(`Failed to setup Get Lab Here in new guild ${guild.name}:`, error);
    }
  },
};
