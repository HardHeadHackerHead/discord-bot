/**
 * Server Stats Module - Displays server statistics in voice channels
 *
 * Creates voice channels that automatically update with server stats like:
 * - Total member count
 * - Online member count
 * - Bot count
 * - Human count
 * - Channel count
 * - Role count
 */

import { ServerStatsModule } from './module.js';

export default new ServerStatsModule();
export { ServerStatsModule };
