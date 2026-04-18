import React from 'react';
import {
  AbsoluteFill,
  Img,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { SectionTitle } from '../components/SectionTitle';
import type { CreditsMember } from '../types';

interface AllMembersSceneProps {
  members: CreditsMember[];
}

const COLUMNS = 4;
const ROW_HEIGHT = 70;
const AVATAR_SIZE = 48;
const TOP_PADDING = 130;
const VISIBLE_HEIGHT = 1080 - TOP_PADDING - 40;

export const AllMembersScene: React.FC<AllMembersSceneProps> = ({
  members,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Calculate total scroll height
  const rows = Math.ceil(members.length / COLUMNS);
  const totalScrollHeight = rows * ROW_HEIGHT;
  const needsScroll = totalScrollHeight > VISIBLE_HEIGHT;

  // Smooth scroll — start after 1 sec, end 1 sec before scene ends
  const scrollStartFrame = 30;
  const scrollEndFrame = durationInFrames - 30;
  const scrollDistance = needsScroll
    ? totalScrollHeight - VISIBLE_HEIGHT + 60
    : 0;

  const scrollY = needsScroll
    ? interpolate(
        frame,
        [scrollStartFrame, scrollEndFrame],
        [0, scrollDistance],
        { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
      )
    : 0;

  // Fade in
  const fadeIn = interpolate(frame, [0, 15], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <SectionTitle
        text="Community Members"
        gradient="linear-gradient(90deg, #5865F2, #7289da, #99aab5)"
      />

      {/* Scrolling member list */}
      <div
        style={{
          position: 'absolute',
          top: TOP_PADDING,
          left: 100,
          right: 100,
          bottom: 40,
          overflow: 'hidden',
          opacity: fadeIn,
        }}
      >
        {/* Gradient fade at top */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 50,
            background:
              'linear-gradient(to bottom, rgba(10,10,15,1), rgba(10,10,15,0))',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            transform: `translateY(${-scrollY}px)`,
            padding: '30px 0',
          }}
        >
          {members.map((member, i) => {
            const rowIndex = Math.floor(i / COLUMNS);
            const yPosition = rowIndex * ROW_HEIGHT - scrollY;
            // Only render if roughly visible
            const isVisible =
              yPosition > -ROW_HEIGHT * 2 && yPosition < VISIBLE_HEIGHT + ROW_HEIGHT * 2;

            if (!isVisible) {
              return (
                <div
                  key={member.userId}
                  style={{
                    width: `${100 / COLUMNS}%`,
                    height: ROW_HEIGHT,
                  }}
                />
              );
            }

            const entryDelay = Math.min(i * 0.3, 20);
            const itemOpacity = interpolate(
              frame,
              [entryDelay, entryDelay + 10],
              [0, 0.9],
              {
                extrapolateLeft: 'clamp',
                extrapolateRight: 'clamp',
              }
            );

            return (
              <div
                key={member.userId}
                style={{
                  width: `${100 / COLUMNS}%`,
                  height: ROW_HEIGHT,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  paddingLeft: 20,
                  opacity: itemOpacity,
                }}
              >
                <div
                  style={{
                    width: AVATAR_SIZE,
                    height: AVATAR_SIZE,
                    borderRadius: '50%',
                    overflow: 'hidden',
                    flexShrink: 0,
                    border: '2px solid rgba(255,255,255,0.15)',
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
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 500,
                    fontFamily: 'Inter, sans-serif',
                    color: 'rgba(255,255,255,0.8)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {member.displayName}
                </span>
              </div>
            );
          })}
        </div>

        {/* Gradient fade at bottom */}
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: 80,
            background:
              'linear-gradient(to top, rgba(10,10,15,1), rgba(10,10,15,0))',
            zIndex: 2,
            pointerEvents: 'none',
          }}
        />
      </div>
    </AbsoluteFill>
  );
};
