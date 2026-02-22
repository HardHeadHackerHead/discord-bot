/**
 * User Tracking Module - Core user tracking functionality
 *
 * This is a core module that tracks users when they join guilds
 * and stores them in the database. It's required by most other modules.
 */

import { UserTrackingModule } from './module.js';

export default new UserTrackingModule();
export { UserTrackingModule };
