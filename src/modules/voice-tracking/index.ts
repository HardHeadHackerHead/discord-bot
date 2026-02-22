/**
 * Voice Tracking Module - Tracks user voice channel time
 *
 * Features:
 * - Tracks voice channel join/leave/switch events
 * - Maintains per-user aggregated stats
 * - /voicetime command to check stats
 * - Leaderboard support
 *
 * Events emitted:
 * - voice-tracking:session-started - When a user joins voice
 * - voice-tracking:session-ended - When a user leaves voice
 *
 * Integration:
 * - If the Points module is loaded, it will automatically award
 *   points based on voice time when sessions end.
 */

import { VoiceTrackingModule } from './module.js';

export default new VoiceTrackingModule();
export { VoiceTrackingModule };
export { VoiceTrackingService } from './services/VoiceTrackingService.js';
