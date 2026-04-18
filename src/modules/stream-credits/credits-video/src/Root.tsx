import React from 'react';
import { Composition, registerRoot, staticFile } from 'remotion';
import { getAudioDurationInSeconds } from '@remotion/media-utils';
import { CreditsVideo, calculateDuration } from './CreditsVideo';
import type { CreditsVideoProps } from './types';

type VideoProps = CreditsVideoProps & { audioDurationFrames?: number };

const FPS = 30;

const sampleData: CreditsVideoProps = {
  guildName: 'QuadsLab',
  guildIconUrl: null,
  boosters: [
    {
      userId: '1',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      isBooster: true,
      isTagWearer: false,
      serverTag: null,
    },
    {
      userId: '2',
      username: 'bob',
      displayName: 'Bob',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
      isBooster: true,
      isTagWearer: false,
      serverTag: null,
    },
    {
      userId: '3',
      username: 'charlie',
      displayName: 'Charlie',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png',
      isBooster: true,
      isTagWearer: false,
      serverTag: null,
    },
  ],
  tagWearers: [
    {
      userId: '4',
      username: 'diana',
      displayName: 'Diana',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png',
      isBooster: false,
      isTagWearer: true,
      serverTag: 'Member',
    },
    {
      userId: '5',
      username: 'eve',
      displayName: 'Eve',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/4.png',
      isBooster: false,
      isTagWearer: true,
      serverTag: 'VIP',
    },
  ],
  allMembers: [
    {
      userId: '1',
      username: 'alice',
      displayName: 'Alice',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      isBooster: true,
      isTagWearer: false,
      serverTag: null,
    },
    {
      userId: '2',
      username: 'bob',
      displayName: 'Bob',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
      isBooster: true,
      isTagWearer: false,
      serverTag: null,
    },
    {
      userId: '3',
      username: 'charlie',
      displayName: 'Charlie',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png',
      isBooster: true,
      isTagWearer: false,
      serverTag: null,
    },
    {
      userId: '4',
      username: 'diana',
      displayName: 'Diana',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/3.png',
      isBooster: false,
      isTagWearer: true,
      serverTag: 'Member',
    },
    {
      userId: '5',
      username: 'eve',
      displayName: 'Eve',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/4.png',
      isBooster: false,
      isTagWearer: true,
      serverTag: 'VIP',
    },
    {
      userId: '6',
      username: 'frank',
      displayName: 'Frank',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      isBooster: false,
      isTagWearer: false,
      serverTag: null,
    },
    {
      userId: '7',
      username: 'grace',
      displayName: 'Grace',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png',
      isBooster: false,
      isTagWearer: false,
      serverTag: null,
    },
    {
      userId: '8',
      username: 'hank',
      displayName: 'Hank',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png',
      isBooster: false,
      isTagWearer: false,
      serverTag: null,
    },
  ],
  growthData: {
    timeline: [
      { date: '2024-01-05', totalMembers: 3 },
      { date: '2024-01-06', totalMembers: 5 },
      { date: '2024-01-10', totalMembers: 8 },
      { date: '2024-01-15', totalMembers: 12 },
      { date: '2024-02-01', totalMembers: 20 },
      { date: '2024-02-15', totalMembers: 28 },
      { date: '2024-03-01', totalMembers: 38 },
      { date: '2024-03-15', totalMembers: 45 },
      { date: '2024-04-01', totalMembers: 58 },
      { date: '2024-04-15', totalMembers: 67 },
      { date: '2024-05-01', totalMembers: 78 },
      { date: '2024-05-15', totalMembers: 89 },
      { date: '2024-06-01', totalMembers: 105 },
      { date: '2024-06-15', totalMembers: 120 },
      { date: '2024-07-01', totalMembers: 140 },
      { date: '2024-07-15', totalMembers: 156 },
      { date: '2024-08-01', totalMembers: 175 },
      { date: '2024-08-15', totalMembers: 198 },
      { date: '2024-09-01', totalMembers: 218 },
      { date: '2024-09-15', totalMembers: 234 },
      { date: '2024-10-01', totalMembers: 255 },
      { date: '2024-10-15', totalMembers: 278 },
      { date: '2024-11-01', totalMembers: 298 },
      { date: '2024-11-15', totalMembers: 315 },
      { date: '2024-12-01', totalMembers: 332 },
      { date: '2024-12-15', totalMembers: 350 },
      { date: '2025-01-01', totalMembers: 375 },
      { date: '2025-01-15', totalMembers: 402 },
      { date: '2025-02-01', totalMembers: 430 },
      { date: '2025-02-15', totalMembers: 458 },
      { date: '2025-03-01', totalMembers: 510 },
    ],
    totalMembers: 510,
    oldestJoinDate: '2024-01-05T00:00:00.000Z',
    newestJoinDate: '2025-03-01T00:00:00.000Z',
  },
  activityStats: {
    topMembers: [
      { userId: '1', displayName: 'Alice', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png', messageCount: 2450, voiceSeconds: 36000 },
      { userId: '2', displayName: 'Bob', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png', messageCount: 1800, voiceSeconds: 28800 },
      { userId: '3', displayName: 'Charlie', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png', messageCount: 1200, voiceSeconds: 14400 },
      { userId: '6', displayName: 'Frank', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png', messageCount: 980, voiceSeconds: 7200 },
      { userId: '7', displayName: 'Grace', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png', messageCount: 750, voiceSeconds: 5400 },
    ],
    totalMessages: 12500,
    totalVoiceHours: 340,
    activeChatterCount: 45,
    activeVoiceCount: 28,
  },
  newMembers: [
    { userId: '10', displayName: 'NewUser1', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png', joinedAt: '2025-02-28T12:00:00.000Z' },
    { userId: '11', displayName: 'NewUser2', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/1.png', joinedAt: '2025-02-27T14:00:00.000Z' },
    { userId: '12', displayName: 'NewUser3', avatarUrl: 'https://cdn.discordapp.com/embed/avatars/2.png', joinedAt: '2025-02-26T10:00:00.000Z' },
  ],
};

const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="CreditsVideo"
        component={CreditsVideo as unknown as React.FC<Record<string, unknown>>}
        width={1920}
        height={1080}
        fps={FPS}
        defaultProps={{ ...sampleData, audioDurationFrames: undefined } as Record<string, unknown>}
        calculateMetadata={async ({ props }) => {
          const videoProps = props as unknown as VideoProps;
          // Try to get audio duration to match video length to song
          let audioDurationFrames: number | undefined;
          try {
            const audioSrc =
              videoProps.audioSrc ||
              staticFile('stream-credits/Till I Log Off - QuadsLab.mp3');
            const audioDuration =
              await getAudioDurationInSeconds(audioSrc);
            audioDurationFrames = Math.round(audioDuration * FPS);
          } catch {
            // Audio not available (e.g., in preview without public dir)
          }

          return {
            durationInFrames: calculateDuration(videoProps, audioDurationFrames),
            props: {
              ...props,
              audioDurationFrames,
            },
          };
        }}
      />
    </>
  );
};

registerRoot(RemotionRoot);
