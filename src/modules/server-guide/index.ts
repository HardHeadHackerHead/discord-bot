/**
 * Server Guide Module
 *
 * Manages server guide embeds from a JSON configuration file.
 * Use /server-guide post to post all embeds to the configured channel.
 */

import { ServerGuideModule } from './module.js';

export default new ServerGuideModule();
export { ServerGuideModule };
