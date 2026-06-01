/**
 * Strava Module — links Discord users to Strava and posts their
 * activities into a configured channel via the quadslab.io webhook
 * pipeline.
 *
 * See module.ts for the lifecycle and the README in this folder for
 * the integration contract with the website.
 */

import { StravaModule } from './module.js';

export default new StravaModule();
export { StravaModule };
export { StravaService } from './services/StravaService.js';
