export interface CreditsMember {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string;
  isBooster: boolean;
  isTagWearer: boolean;
  serverTag: string | null;
}

export interface GrowthDataPoint {
  date: string; // YYYY-MM-DD format (daily granularity)
  totalMembers: number;
}

export interface GrowthStats {
  timeline: GrowthDataPoint[];
  totalMembers: number;
  oldestJoinDate: string | null;
  newestJoinDate: string | null;
}

export interface TopMember {
  userId: string;
  displayName: string;
  avatarUrl: string;
  messageCount: number;
  voiceSeconds: number;
}

export interface ActivityStats {
  topMembers: TopMember[];
  totalMessages: number;
  totalVoiceHours: number;
  activeChatterCount: number;
  activeVoiceCount: number;
}

export interface YouTubeChannelStats {
  channelName: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
  channelThumbnail: string | null;
}

export interface YouTubeVideoStats {
  title: string;
  viewCount: number;
  likeCount: number;
  publishedAt: string;
  thumbnailUrl: string | null;
}

export interface YouTubeData {
  channel: YouTubeChannelStats;
  recentVideos: YouTubeVideoStats[];
}

export interface NewMember {
  userId: string;
  displayName: string;
  avatarUrl: string;
  joinedAt: string;
}

export interface CreditsVideoProps {
  guildName: string;
  guildIconUrl: string | null;
  boosters: CreditsMember[];
  tagWearers: CreditsMember[];
  allMembers: CreditsMember[];
  growthData: GrowthStats;
  activityStats?: ActivityStats;
  youtubeData?: YouTubeData;
  newMembers?: NewMember[];
  audioSrc?: string;
}
