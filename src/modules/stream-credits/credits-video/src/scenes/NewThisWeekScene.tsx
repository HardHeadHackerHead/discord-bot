import React from 'react';
import {
  AbsoluteFill,
  Img,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { SectionTitle } from '../components/SectionTitle';
import type { NewMember } from '../types';

interface NewThisWeekSceneProps {
  newMembers: NewMember[];
}

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatJoinDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${monthNames[d.getMonth()]} ${d.getDate()}`;
}

export const NewThisWeekScene: React.FC<NewThisWeekSceneProps> = ({
  newMembers,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Grid layout — max 5 columns
  const columns = Math.min(5, newMembers.length);
  const rows = Math.ceil(newMembers.length / columns);

  return (
    <AbsoluteFill>
      <SectionTitle
        text="Welcome, New Members!"
        gradient="linear-gradient(90deg, #00d2d3, #54e3e4, #5865F2)"
      />

      <div
        style={{
          position: 'absolute',
          top: 160,
          left: 0,
          right: 0,
          bottom: 60,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 20,
            maxWidth: columns * 200,
          }}
        >
          {newMembers.slice(0, 20).map((member, i) => {
            const delay = 15 + i * 5;

            const entryScale = spring({
              frame: frame - delay,
              fps,
              config: { damping: 12, stiffness: 70, mass: 0.8 },
            });

            // Gentle float after entry
            const float =
              entryScale > 0.9
                ? Math.sin((frame - delay) * 0.04 + i) * 4
                : 0;

            return (
              <div
                key={member.userId}
                style={{
                  width: 160,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 10,
                  transform: `scale(${entryScale}) translateY(${float}px)`,
                  opacity: entryScale,
                }}
              >
                {/* Glow ring */}
                <div
                  style={{
                    width: 90,
                    height: 90,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    border: '3px solid #00d2d3',
                    boxShadow:
                      '0 0 20px rgba(0, 210, 211, 0.4), 0 0 40px rgba(0, 210, 211, 0.15)',
                    backgroundColor: '#1a1a2e',
                  }}
                >
                  <Img
                    src={member.avatarUrl}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                    }}
                  />
                </div>

                {/* Name */}
                <div
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    fontFamily: 'Inter, sans-serif',
                    color: '#ffffff',
                    textAlign: 'center',
                    maxWidth: 150,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {member.displayName}
                </div>

                {/* Join date */}
                <div
                  style={{
                    fontSize: 12,
                    fontFamily: 'Inter, sans-serif',
                    color: 'rgba(255, 255, 255, 0.4)',
                  }}
                >
                  Joined {formatJoinDate(member.joinedAt)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Count badge */}
      <div
        style={{
          position: 'absolute',
          bottom: 40,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            fontSize: 18,
            fontFamily: 'Inter, sans-serif',
            color: 'rgba(255, 255, 255, 0.4)',
            letterSpacing: 2,
          }}
        >
          {newMembers.length} new member{newMembers.length !== 1 ? 's' : ''}{' '}
          this week
        </div>
      </div>
    </AbsoluteFill>
  );
};
