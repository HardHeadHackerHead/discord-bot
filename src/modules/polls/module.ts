import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as pollCommand, setPollsService as setCommandService } from './commands/poll.js';
import { interactionCreateEvent, setPollsService as setInteractionService, setEventBus } from './events/interactionCreate.js';
import { PollsService } from './services/PollsService.js';
import { DatabaseService } from '../../core/database/mysql.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Polls');

// Global reference for other modules to access
let globalPollsService: PollsService | null = null;

/**
 * Get the polls service instance (for other modules to use)
 */
export function getPollsService(): PollsService | null {
  return globalPollsService;
}

/**
 * Polls Module - Create and manage polls with voting
 *
 * Features:
 * - Standard polls with multiple options
 * - Lab ownership transfer polls (triggered by dynamic-lab module)
 * - Vote buttons or select menus depending on option count
 * - Optional time limits
 * - Multiple votes or single vote per user
 * - Anonymous voting option
 */
export class PollsModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'polls',
    name: 'Polls',
    description: 'Create and manage polls with voting',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    optionalDependencies: ['dynamic-lab'],
    priority: 50,
  };

  readonly migrationsPath = 'migrations';

  private pollsService: PollsService | null = null;
  private pollExpiryInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();

    this.commands = [pollCommand];
    this.events = [interactionCreateEvent];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);

    // Create services
    const dbService = new DatabaseService();
    this.pollsService = new PollsService(dbService);
    globalPollsService = this.pollsService;

    // Inject into commands and events
    setCommandService(this.pollsService);
    setInteractionService(this.pollsService);
    setEventBus(context.events);

    // Start poll expiry checker (every 30 seconds)
    this.startExpiryChecker();

    logger.info('Polls module loaded');
  }

  async onEnable(guildId: string): Promise<void> {
    logger.debug(`Polls module enabled for guild ${guildId}`);
  }

  async onDisable(guildId: string): Promise<void> {
    logger.debug(`Polls module disabled for guild ${guildId}`);
  }

  async onUnload(): Promise<void> {
    // Stop expiry checker
    if (this.pollExpiryInterval) {
      clearInterval(this.pollExpiryInterval);
      this.pollExpiryInterval = null;
    }

    // Clear global reference
    globalPollsService = null;
    this.pollsService = null;

    logger.info('Polls module unloaded');
  }

  /**
   * Start the poll expiry checker interval
   */
  private startExpiryChecker(): void {
    this.pollExpiryInterval = setInterval(async () => {
      if (!this.pollsService) return;

      try {
        const expiredPolls = await this.pollsService.checkExpiredPolls();

        for (const poll of expiredPolls) {
          await this.handlePollExpired(poll.id);
        }
      } catch (error) {
        logger.error('Error checking expired polls:', error);
      }
    }, 30_000); // Check every 30 seconds
  }

  /**
   * Handle a poll that has expired
   */
  private async handlePollExpired(pollId: string): Promise<void> {
    if (!this.pollsService || !this.context) return;

    try {
      const poll = await this.pollsService.getPoll(pollId);
      if (!poll || !poll.message_id) return;

      const options = await this.pollsService.getPollOptionsWithVotes(pollId);
      const totalVoters = await this.pollsService.getTotalVotes(pollId);
      const winners = await this.pollsService.getWinners(pollId);

      // Import PollsPanel here to avoid circular dependencies
      const { PollsPanel } = await import('./components/PollsPanel.js');
      const resultsEmbed = PollsPanel.createResultsEmbed(poll, options, totalVoters, winners);

      // Try to update the message
      try {
        const channel = await this.context.client.channels.fetch(poll.channel_id);
        if (channel && channel.isTextBased() && 'messages' in channel) {
          const textChannel = channel as import('discord.js').TextChannel;
          const message = await textChannel.messages.fetch(poll.message_id);
          await message.edit({
            embeds: [resultsEmbed],
            components: PollsPanel.createDisabledComponents(),
          });
        }
      } catch (error) {
        logger.debug(`Could not update expired poll message: ${pollId}`);
      }

      // If this was a lab ownership poll, emit an event with the winner
      if (poll.poll_type === 'lab_ownership' && winners.length > 0 && poll.context_id) {
        const winner = winners[0];
        const winnerId = winner?.value; // The user ID of the winner
        if (winnerId && winner) {
          // Emit event for dynamic-lab module to handle
          this.context.events.emitAsync(
            'polls:lab-ownership-decided',
            this.metadata.id,
            {
              pollId: poll.id,
              channelId: poll.context_id,
              guildId: poll.guild_id,
              winnerId,
              winnerVotes: winner.vote_count,
              totalVoters,
              isTie: winners.length > 1,
            }
          );
        }
      }

      logger.info(`Poll ${pollId} expired and processed`);
    } catch (error) {
      logger.error(`Error handling expired poll ${pollId}:`, error);
    }
  }
}
