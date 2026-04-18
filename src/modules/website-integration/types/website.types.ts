/**
 * Website Integration Types
 *
 * Activity events use a dynamic schema - the bot defines what events exist
 * and the website renders them accordingly. This allows adding new event
 * types without coordinating schema changes.
 */

// ============================================================================
// ACTIVITY EVENTS (Dynamic Schema)
// ============================================================================

/**
 * Activity event categories for grouping/filtering on the website
 */
export type ActivityCategory = 'social' | 'achievement' | 'voice' | 'moderation';

/**
 * Activity event sent to the website.
 * Uses a flexible structure where the bot defines the event schema.
 *
 * The website should:
 * 1. Store events as-is (type + metadata are arbitrary)
 * 2. Use title/description for display
 * 3. Use category for filtering
 * 4. Use emoji for visual representation
 * 5. Store metadata for future features (click to view details, etc.)
 */
export interface ActivityEvent {
  // Event identification
  type: string; // e.g., 'member_join', 'voice_join', 'level_up', 'custom_event'

  // User info (who triggered the event)
  user: {
    id: string;
    username: string;
    avatar: string;
  };

  // Display info (how to show the event)
  title: string; // e.g., "Joined the server", "Reached Level 10"
  description?: string; // Optional longer description
  emoji: string; // e.g., "👋", "🎤", "🎉"
  category: ActivityCategory;

  // Flexible metadata (event-specific data)
  metadata?: Record<string, unknown>;

  // Timing
  timestamp: string; // ISO 8601
}

// Batched activity payload (secret sent via Authorization header)
export interface ActivityPayload {
  events: ActivityEvent[];
}

// ============================================================================
// LEADERBOARD SYNC (Bot -> Website)
// ============================================================================

// Dynamic leaderboard category from registry
export interface LeaderboardCategory {
  id: string;
  name: string;
  description: string;
  emoji: string;
  unit: string;
  moduleId: string;
  hasSecondaryValue: boolean;
}

// Leaderboard user with dynamic values
export interface LeaderboardUser {
  discordId: string;
  username: string;
  avatar: string;
  values: Record<string, { value: number; secondaryValue?: number }>;
}

// Dynamic leaderboard sync payload (secret sent via Authorization header)
export interface DynamicLeaderboardPayload {
  categories: LeaderboardCategory[];
  users: LeaderboardUser[];
  lastUpdated: string;
}

// ============================================================================
// WEBSITE INTERACTIONS (Website -> Bot)
// ============================================================================

// Website interaction types
export type InteractionType = 'lab_bell' | 'wave' | 'spin_wheel' | 'poke';

// Pending interaction from website
export interface PendingInteraction {
  id: string;
  type: InteractionType;
  createdAt: string;
}

// Response from pending interactions endpoint
export interface PendingInteractionsResponse {
  success: boolean;
  interactions: PendingInteraction[];
}

// Payload to mark interactions as processed (secret sent via Authorization header)
export interface ProcessedInteractionsPayload {
  processed: string[];
}

// ============================================================================
// POKE A SCIENTIST (Two-way interaction)
// ============================================================================

/**
 * Poke response options - the bot defines what responses are available.
 * The website just displays whatever emoji/message we send back.
 */
export interface PokeResponse {
  id: string;
  emoji: string;
  label: string; // Button label in Discord
  message: string; // Message shown to website visitor
}

// Payload to respond to a poke interaction
export interface PokeResponsePayload {
  emoji: string;
  message: string;
  respondedBy: string; // Discord display name
  avatar: string; // Discord avatar URL
}

// Available poke responses - bot controls these, website just renders them
export const POKE_RESPONSES: PokeResponse[] = [
  {
    id: 'come_hang',
    emoji: '👋',
    label: 'Come hang out!',
    message: "Hey! Come hang out with us in the Lab!",
  },
  {
    id: 'join_us',
    emoji: '🎯',
    label: 'Join us!',
    message: "We're working on something cool - come join the conversation!",
  },
  {
    id: 'busy',
    emoji: '🔬',
    label: 'Busy experimenting',
    message: "I'm deep in an experiment, but join the server and say hi!",
  },
  {
    id: 'later',
    emoji: '⏰',
    label: 'Try later',
    message: "Can't chat right now, but definitely join the Lab and catch us later!",
  },
];

// ============================================================================
// WAVE BACK (Multi-response interaction)
// ============================================================================

// Payload for a wave back response
export interface WaveBackPayload {
  respondedBy: string; // Discord display name
  avatar: string; // Discord avatar URL
}

// ============================================================================
// WEBHOOK SERVER (Website -> Bot direct requests)
// ============================================================================

// Incoming webhook request for interactions
export interface WebhookInteractionRequest {
  visitorId: string; // Unique visitor session ID
  timestamp: string; // ISO 8601
}

// Webhook response for interactions
export interface WebhookInteractionResponse {
  success: boolean;
  interactionId?: string; // For tracking responses (poke/wave)
  error?: string;
}

// Voice channel member info
export interface VoiceChannelMember {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  streaming: boolean;
  camera: boolean;
  muted: boolean;
  deafened: boolean;
}

// Voice channel info
export interface VoiceChannelInfo {
  id: string;
  name: string;
  members: VoiceChannelMember[];
}

// Voice status response
export interface VoiceStatusResponse {
  success: boolean;
  channels: VoiceChannelInfo[];
  totalInVoice: number;
}

// Online status response
export interface OnlineStatusResponse {
  success: boolean;
  online: number;
  idle: number;
  dnd: number;
  total: number;
}

// Server info response
export interface ServerInfoResponse {
  success: boolean;
  server: {
    id: string;
    name: string;
    icon: string | null;
    memberCount: number;
    boostLevel: number;
    boostCount: number;
  };
}

// Leaderboard entry for API response
export interface LeaderboardEntry {
  rank: number;
  odgId: string;
  username: string;
  avatar: string;
  value: number;
  secondaryValue?: number;
}

// Leaderboard response
export interface LeaderboardResponse {
  success: boolean;
  category?: {
    id: string;
    name: string;
    emoji: string;
    unit: string;
  };
  entries?: LeaderboardEntry[];
  lastUpdated?: string;
  error?: string;
}

// ============================================================================
// BOT URL REGISTRATION
// ============================================================================

// Payload to register the bot's webhook URL with the website
export interface BotUrlRegistrationPayload {
  botUrl: string;           // The public URL where the bot's webhook server is accessible
  endpoints: {
    poke: string;           // Full URL for poke interactions
    wave: string;           // Full URL for wave interactions
    labBell: string;        // Full URL for lab bell interactions
    voiceStatus: string;    // Full URL for voice status data
    onlineStatus: string;   // Full URL for online member count
    serverInfo: string;     // Full URL for server info
    health: string;         // Full URL for health check
  };
  registeredAt: string;     // ISO 8601 timestamp
  expiresAt?: string;       // Optional expiration (for ngrok free tier URLs that change)
}

// ============================================================================
// API RESPONSE & SETTINGS
// ============================================================================

// Website API response
export interface WebsiteApiResponse {
  success: boolean;
  message?: string;
  error?: string;
}

// Module settings interface
export interface WebsiteIntegrationSettings extends Record<string, unknown> {
  website_url: string;
  webhook_secret: string;
  interaction_channel_id: string;
  leaderboard_sync_interval: number; // in minutes
  interaction_poll_interval: number; // in seconds (deprecated - use webhook server)
  activity_batch_interval: number; // in seconds
  enabled: boolean;
  poke_responder_role_id: string; // Role to ping for poke interactions
  poke_points_reward: number; // Points awarded for responding to pokes
  // Webhook server settings
  webhook_server_enabled: boolean;
  webhook_server_port: number;
  webhook_rate_limit: number; // Requests per minute
  // Ngrok tunnel settings
  ngrok_enabled: boolean; // Enable automatic ngrok tunnel
  ngrok_auth_token: string; // Ngrok auth token (optional - for authenticated tunnels)
  ngrok_region: string; // Ngrok region: us, eu, ap, au, sa, jp, in
}

// Sync history record
export interface SyncHistoryRecord {
  id: string;
  guild_id: string;
  sync_type: 'leaderboard' | 'activity' | 'interaction';
  items_synced: number;
  success: boolean;
  error_message: string | null;
  created_at: Date;
}

// Connection status
export interface ConnectionStatus {
  connected: boolean;
  lastSuccessfulSync: Date | null;
  lastError: string | null;
  pendingEvents: number;
}
