/**
 * Deafen Sync Module - Mirrors a user's client deafen onto a server deafen
 *
 * Counters "fake deafen" clients, which report self-deafened to Discord
 * while still receiving audio. For users on the watch list, a client
 * deafen becomes a real server deafen, and a client undeafen lifts it.
 */

import { DeafenSyncModule } from './module.js';

export default new DeafenSyncModule();
export { DeafenSyncModule };
