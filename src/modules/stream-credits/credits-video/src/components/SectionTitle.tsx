import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';

interface SectionTitleProps {
  text: string;
  gradient?: string;
}

export const SectionTitle: React.FC<SectionTitleProps> = ({
  text,
  gradient = 'linear-gradient(90deg, #ff6b9d, #c44dff, #00d2d3)',
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const slideIn = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 80, mass: 1 },
  });

  const translateX = (1 - slideIn) * -200;
  const underlineScale = spring({
    frame: frame - 10,
    fps,
    config: { damping: 15, stiffness: 100 },
  });

  return (
    <div
      style={{
        position: 'absolute',
        top: 40,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        transform: `translateX(${translateX}px)`,
        opacity: slideIn,
      }}
    >
      <h2
        style={{
          fontSize: 52,
          fontWeight: 800,
          fontFamily: 'Inter, sans-serif',
          background: gradient,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          textShadow: 'none',
          letterSpacing: -1,
        }}
      >
        {text}
      </h2>
      <div
        style={{
          marginTop: 12,
          height: 3,
          width: 200,
          background: gradient,
          borderRadius: 2,
          transform: `scaleX(${underlineScale})`,
          transformOrigin: 'center',
        }}
      />
    </div>
  );
};
