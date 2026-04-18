import React from 'react';
import {
  AbsoluteFill,
  Img,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { SectionTitle } from '../components/SectionTitle';
import type { ActivityStats } from '../types';

interface ActivitySceneProps {
  activityStats: ActivityStats;
}

function formatHours(h: number): string {
  if (h >= 1000) return `${(h / 1000).toFixed(1)}K`;
  return h.toLocaleString();
}

export const ActivityScene: React.FC<ActivitySceneProps> = ({
  activityStats,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { topMembers, totalMessages, totalVoiceHours, activeChatterCount, activeVoiceCount } = activityStats;

  // Summary stats entrance
  const statsScale = spring({
    frame: frame - 10,
    fps,
    config: { damping: 12, stiffness: 80 },
  });

  return (
    <AbsoluteFill>
      <SectionTitle
        text="Most Active Members"
        gradient="linear-gradient(90deg, #ffc107, #ff9800, #ff5722)"
      />

      {/* Summary stats */}
      <div
        style={{
          position: 'absolute',
          top: 130,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 80,
          transform: `scale(${statsScale})`,
          opacity: statsScale,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 42,
              fontWeight: 800,
              fontFamily: 'Inter, sans-serif',
              background: 'linear-gradient(90deg, #ffc107, #ff9800)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {totalMessages.toLocaleString()}
          </div>
          <div
            style={{
              fontSize: 14,
              fontFamily: 'Inter, sans-serif',
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            Total Messages
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 42,
              fontWeight: 800,
              fontFamily: 'Inter, sans-serif',
              background: 'linear-gradient(90deg, #ff9800, #ff5722)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {formatHours(totalVoiceHours)}h
          </div>
          <div
            style={{
              fontSize: 14,
              fontFamily: 'Inter, sans-serif',
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            Voice Hours
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 42,
              fontWeight: 800,
              fontFamily: 'Inter, sans-serif',
              background: 'linear-gradient(90deg, #ff5722, #e91e63)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {activeChatterCount + activeVoiceCount}
          </div>
          <div
            style={{
              fontSize: 14,
              fontFamily: 'Inter, sans-serif',
              color: 'rgba(255,255,255,0.5)',
              letterSpacing: 2,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            Active Members
          </div>
        </div>
      </div>

      {/* Leaderboard */}
      <div
        style={{
          position: 'absolute',
          top: 260,
          left: 200,
          right: 200,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {topMembers.slice(0, 10).map((member, i) => {
          const entryProgress = spring({
            frame: frame - 30 - i * 5,
            fps,
            config: { damping: 14, stiffness: 70 },
          });

          const translateX = (1 - entryProgress) * 300;
          const isTop3 = i < 3;
          const barMaxWidth = 600;
          const maxScore = topMembers[0]
            ? topMembers[0].messageCount + topMembers[0].voiceSeconds
            : 1;
          const score = member.messageCount + member.voiceSeconds;
          const barWidth = (score / maxScore) * barMaxWidth;

          const medals = ['#FFD700', '#C0C0C0', '#CD7F32'];
          const rankColor = isTop3 ? medals[i]! : 'rgba(255,255,255,0.4)';

          return (
            <div
              key={member.userId}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                height: 64,
                transform: `translateX(${translateX}px)`,
                opacity: entryProgress,
              }}
            >
              {/* Rank */}
              <div
                style={{
                  width: 40,
                  fontSize: isTop3 ? 28 : 20,
                  fontWeight: 800,
                  fontFamily: 'Inter, sans-serif',
                  color: rankColor,
                  textAlign: 'center',
                }}
              >
                {i + 1}
              </div>

              {/* Avatar */}
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: isTop3
                    ? `2px solid ${rankColor}`
                    : '2px solid rgba(255,255,255,0.15)',
                  boxShadow: isTop3
                    ? `0 0 12px ${rankColor}40`
                    : 'none',
                }}
              >
                <Img
                  src={member.avatarUrl}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              </div>

              {/* Name + bar */}
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: 18,
                    fontWeight: 600,
                    fontFamily: 'Inter, sans-serif',
                    color: isTop3 ? '#ffffff' : 'rgba(255,255,255,0.8)',
                    marginBottom: 4,
                  }}
                >
                  {member.displayName}
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: 'rgba(255,255,255,0.08)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: barWidth * entryProgress,
                      height: '100%',
                      borderRadius: 3,
                      background: isTop3
                        ? `linear-gradient(90deg, ${rankColor}, ${rankColor}88)`
                        : 'linear-gradient(90deg, #ff9800, #ff572288)',
                    }}
                  />
                </div>
              </div>

              {/* Stats */}
              <div
                style={{
                  textAlign: 'right',
                  minWidth: 140,
                }}
              >
                <span
                  style={{
                    fontSize: 14,
                    fontFamily: 'Inter, sans-serif',
                    color: 'rgba(255,255,255,0.5)',
                  }}
                >
                  {member.messageCount.toLocaleString()} msgs &middot;{' '}
                  {Math.round(member.voiceSeconds / 3600)}h voice
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
