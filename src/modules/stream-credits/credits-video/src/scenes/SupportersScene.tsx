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
import type { CreditsMember } from '../types';

interface SupportersSceneProps {
  tagWearers: CreditsMember[];
}

function seededDirection(userId: string): { x: number; y: number } {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  }
  const angle = ((hash & 0xffff) / 0xffff) * Math.PI * 2;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

const FlyingProfile: React.FC<{
  member: CreditsMember;
  index: number;
  total: number;
}> = ({ member, index, total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const delay = index * 6;
  const dir = seededDirection(member.userId);

  const progress = spring({
    frame: frame - delay,
    fps,
    config: { damping: 14, stiffness: 60, mass: 1 },
  });

  if (frame < delay) return null;

  const startX = dir.x * 1200;
  const startY = dir.y * 800;
  const currentX = startX * (1 - progress);
  const currentY = startY * (1 - progress);

  // Rotation that settles to 0
  const rotation = (1 - progress) * (dir.x > 0 ? 360 : -360);

  // Float after settling
  const floatY = progress > 0.9 ? Math.sin((frame - delay) * 0.05) * 5 : 0;

  // Grid position
  const columns = Math.min(6, Math.ceil(Math.sqrt(total)));
  const row = Math.floor(index / columns);
  const col = index % columns;
  const cellWidth = 160;
  const cellHeight = 180;
  const gridWidth = columns * cellWidth;
  const startGridX = -gridWidth / 2 + cellWidth / 2;
  const startGridY = -((Math.ceil(total / columns) * cellHeight) / 2) + cellHeight / 2;

  const targetX = startGridX + col * cellWidth;
  const targetY = startGridY + row * cellHeight;

  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: '55%',
        transform: `translate(${targetX + currentX}px, ${targetY + currentY + floatY}px) rotate(${rotation}deg)`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        opacity: Math.min(1, progress * 3),
      }}
    >
      <div
        style={{
          width: 110,
          height: 110,
          borderRadius: '50%',
          border: '3px solid #00d2d3',
          boxShadow:
            '0 0 20px rgba(0, 210, 211, 0.6), 0 0 40px rgba(0, 210, 211, 0.3)',
          overflow: 'hidden',
          backgroundColor: '#1a1a2e',
        }}
      >
        <Img
          src={member.avatarUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      <span
        style={{
          fontSize: 16,
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif',
          color: '#ffffff',
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          textAlign: 'center',
          maxWidth: 130,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {member.displayName}
      </span>
    </div>
  );
};

export const SupportersScene: React.FC<SupportersSceneProps> = ({
  tagWearers,
}) => {
  return (
    <AbsoluteFill>
      <SectionTitle
        text="Special Thanks to Our Supporters"
        gradient="linear-gradient(90deg, #00d2d3, #54e3e4, #7efcfc)"
      />
      {tagWearers.map((member, i) => (
        <FlyingProfile
          key={member.userId}
          member={member}
          index={i}
          total={tagWearers.length}
        />
      ))}
    </AbsoluteFill>
  );
};
