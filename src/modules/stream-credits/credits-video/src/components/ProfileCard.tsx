import React from 'react';
import { Img, spring, useCurrentFrame, useVideoConfig } from 'remotion';

interface ProfileCardProps {
  avatarUrl: string;
  displayName: string;
  variant: 'booster' | 'supporter';
  delay: number;
}

const COLORS = {
  booster: {
    glow: 'rgba(255, 107, 157, 0.6)',
    glowOuter: 'rgba(255, 107, 157, 0.3)',
    border: '#ff6b9d',
  },
  supporter: {
    glow: 'rgba(0, 210, 211, 0.6)',
    glowOuter: 'rgba(0, 210, 211, 0.3)',
    border: '#00d2d3',
  },
};

export const ProfileCard: React.FC<ProfileCardProps> = ({
  avatarUrl,
  displayName,
  variant,
  delay,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const colors = COLORS[variant];

  const scaleIn = spring({
    frame: frame - delay,
    fps,
    config: { damping: 12, stiffness: 100, mass: 0.8 },
  });

  const floatY = Math.sin((frame - delay) * 0.05) * 6;
  const opacity = Math.min(1, Math.max(0, (frame - delay) / 8));

  if (frame < delay) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        transform: `scale(${scaleIn}) translateY(${floatY}px)`,
        opacity,
      }}
    >
      <div
        style={{
          width: 120,
          height: 120,
          borderRadius: '50%',
          border: `3px solid ${colors.border}`,
          boxShadow: `0 0 20px ${colors.glow}, 0 0 40px ${colors.glowOuter}`,
          overflow: 'hidden',
          backgroundColor: '#1a1a2e',
        }}
      >
        <Img
          src={avatarUrl}
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
          fontWeight: 600,
          fontFamily: 'Inter, sans-serif',
          color: '#ffffff',
          textShadow: '0 2px 8px rgba(0,0,0,0.5)',
          textAlign: 'center',
          maxWidth: 140,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {displayName}
      </span>
    </div>
  );
};
