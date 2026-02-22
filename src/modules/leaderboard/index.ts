/**
 * Leaderboard Module - Central leaderboard system
 *
 * This module provides a unified /leaderboard command that displays
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

import { LeaderboardModule } from './module.js';

export default new LeaderboardModule();
export { LeaderboardModule };
