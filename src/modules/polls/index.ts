/**
 * Polls Module - Create and manage polls with voting
 *
 * Features:
 * - /poll create <title> <options> - Create a new poll
 * - /poll end <poll_id> - End an active poll
 * - /poll list - List active polls in the server
 *
 * Poll Types:
 * - standard: Regular polls created via /poll command
 * - lab_ownership: Transfer ownership of a lab when owner leaves
 * - custom: For future extensibility
 *
 * Options:
 * - Duration: Auto-end after specified time
 * - Multiple votes: Allow users to vote for multiple options
 * - Anonymous: Hide who voted for what
 *
 * Inter-module Communication:
 * - Emits 'polls:lab-ownership-decided' when a lab ownership poll ends
 * - getPollsService() can be imported by other modules to create polls programmatically
 */

import { PollsModule, getPollsService } from './module.js';

export default new PollsModule();
export { PollsModule, getPollsService };
