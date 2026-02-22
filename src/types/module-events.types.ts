/**
 * Shared event type definitions for inter-module communication.
 *
 * When modules emit events that other modules can consume,
 * define the event payload types here so both sides have type safety.
 *
 * Event naming convention: `module-id:event-name`
 * Type naming convention: `ModuleIdEventNameEvent`
 */

// ==================== Points Module Events ====================

/**
 * Emitted when points are awarded to a user
 * Event: `points:awarded`
 */
export interface PointsAwardedEvent {
  userId: string;
  guildId: string;
  amount: number;
  reason: string;
  source: 'manual' | 'voice' | 'message' | 'daily' | 'other';
  newBalance: number;
}

/**
 * Emitted when points are removed from a user
 * Event: `points:removed`
 */
export interface PointsRemovedEvent {
  userId: string;
  guildId: string;
  amount: number;
  reason: string;
  newBalance: number;
}

// ==================== Voice Tracking Module Events ====================

/**
 * Emitted when a voice session ends
 * Event: `voice-tracking:session-ended`
 */
export interface VoiceSessionEndedEvent {
  userId: string;
  guildId: string;
  channelId: string;
  /** Duration in seconds */
  duration: number;
  startTime: Date;
  endTime: Date;
}

/**
 * Emitted when a voice session starts
 * Event: `voice-tracking:session-started`
 */
export interface VoiceSessionStartedEvent {
  userId: string;
  guildId: string;
  channelId: string;
  startTime: Date;
}

// ==================== Message Tracking Module Events ====================

/**
 * Emitted when a user sends a message (after cooldown check)
 * Event: `message-tracking:message-counted`
 */
export interface MessageCountedEvent {
  userId: string;
  guildId: string;
  channelId: string;
  messageId: string;
  newCount: number;
}

// ==================== User Tracking Module Events ====================

/**
 * Emitted when a new user joins a guild
 * Event: `user-tracking:user-joined`
 */
export interface UserJoinedEvent {
  userId: string;
  guildId: string;
  username: string;
  isNew: boolean; // true if first time seeing this user
}

/**
 * Emitted when a user leaves a guild
 * Event: `user-tracking:user-left`
 */
export interface UserLeftEvent {
  userId: string;
  guildId: string;
  username: string;
}

// ==================== Polls Module Events ====================

/**
 * Emitted when a lab ownership poll ends and a winner is decided
 * Event: `polls:lab-ownership-decided`
 */
export interface LabOwnershipDecidedEvent {
  pollId: string;
  channelId: string;
  guildId: string;
  winnerId: string;
  winnerVotes: number;
  totalVoters: number;
  isTie: boolean;
}

/**
 * Emitted when a poll ends
 * Event: `polls:poll-ended`
 */
export interface PollEndedEvent {
  pollId: string;
  guildId: string;
  channelId: string;
  pollType: 'standard' | 'lab_ownership' | 'custom';
  totalVoters: number;
  winnerIds: string[];
  isTie: boolean;
}

// ==================== Dynamic Lab Module Events ====================

/**
 * Emitted when a lab owner leaves their lab (with members still in it)
 * Event: `dynamic-lab:owner-left`
 */
export interface LabOwnerLeftEvent {
  labId: string;
  channelId: string;
  guildId: string;
  previousOwnerId: string;
  remainingMemberIds: string[];
}

// ==================== Event Name Constants ====================

/**
 * Constants for event names to avoid typos
 */
export const MODULE_EVENTS = {
  // Points
  POINTS_AWARDED: 'points:awarded',
  POINTS_REMOVED: 'points:removed',

  // Voice Tracking
  VOICE_SESSION_STARTED: 'voice-tracking:session-started',
  VOICE_SESSION_ENDED: 'voice-tracking:session-ended',

  // Message Tracking
  MESSAGE_COUNTED: 'message-tracking:message-counted',

  // User Tracking
  USER_JOINED: 'user-tracking:user-joined',
  USER_LEFT: 'user-tracking:user-left',

  // Polls
  POLL_ENDED: 'polls:poll-ended',
  LAB_OWNERSHIP_DECIDED: 'polls:lab-ownership-decided',

  // Dynamic Lab
  LAB_OWNER_LEFT: 'dynamic-lab:owner-left',
} as const;
