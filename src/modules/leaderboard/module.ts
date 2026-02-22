import { BaseModule, ModuleMetadata, ModuleContext } from '../../types/module.types.js';
import { command as leaderboardCommand } from './commands/leaderboard.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('Leaderboard');

/**
 * Leaderboard Module - Central leaderboard system
 *
 * This module provides a unified leaderboard command that displays
 * leaderboards from various other modules. Modules register their
 * leaderboard providers with the LeaderboardRegistry, and this module
 * provides the UI to view and navigate them.
 *
 * Features:
 * - Dropdown to switch between different leaderboards
 * - Pagination for large leaderboards
 * - Autocomplete for leaderboard type selection
 * - User's own rank shown at bottom
 */
export class LeaderboardModule extends BaseModule {
  readonly metadata: ModuleMetadata = {
    id: 'leaderboard',
    name: 'Leaderboard',
    description: 'Central leaderboard system with support for multiple leaderboard types',
    version: '1.0.0',
    author: 'QuadsLab',
    isCore: false,
    isPublic: true,
    dependencies: [],
    priority: 60, // Load after modules that register leaderboards
  };

  constructor() {
    super();

    this.commands = [leaderboardCommand];
    this.events = [];
  }

  async onLoad(context: ModuleContext): Promise<void> {
    await super.onLoad(context);
    logger.info('Leaderboard module loaded');
  }

  async onUnload(): Promise<void> {
    await super.onUnload();
    logger.info('Leaderboard module unloaded');
  }
}
