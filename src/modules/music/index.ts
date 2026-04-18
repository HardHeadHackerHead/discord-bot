/**
 * Music Module - Play music in voice channels
 *
 * Features:
 * - Search and play tracks from an external streaming provider
 * - Queue management with skip, stop, and queue viewing
 * - Playlists: create, delete, add/remove tracks, public/private visibility
 * - Like tracks with per-user tracking
 * - Play count and listen time stats
 * - Now Playing embeds with interactive buttons
 * - Auto-disconnect on idle or when alone in voice
 * - Leaderboard integration for top listeners
 *
 * Commands:
 * - /play <query> [playlist] - Play a track or playlist
 * - /music stop - Stop playback and leave voice
 * - /music skip - Skip current track
 * - /music queue - View the queue
 * - /music playlist create/delete/add/remove/list/view - Manage playlists
 *
 * Environment:
 * - MUSIC_STREAMING_API_URL - Base URL of the streaming provider
 * - MUSIC_STREAMING_API_KEY - API key for authentication
 */

import { MusicModule } from './module.js';

export default new MusicModule();
export { MusicModule };
export { MusicService } from './services/MusicService.js';
export { StreamingClient } from './services/StreamingClient.js';
export { PlaybackManager } from './services/PlaybackManager.js';
