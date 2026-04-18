import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';

interface Particle {
  x: number;
  y: number;
  size: number;
  speed: number;
  opacity: number;
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 49297;
  return x - Math.floor(x);
}

function generateParticles(count: number): Particle[] {
  return Array.from({ length: count }, (_, i) => ({
    x: seededRandom(i * 7 + 1) * 100,
    y: seededRandom(i * 13 + 3) * 100,
    size: seededRandom(i * 17 + 5) * 3 + 1,
    speed: seededRandom(i * 23 + 7) * 0.3 + 0.1,
    opacity: seededRandom(i * 31 + 11) * 0.4 + 0.1,
  }));
}

const particles = generateParticles(40);

export const ParticleBackground: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  return (
    <AbsoluteFill
      style={{
        background:
          'radial-gradient(ellipse at center, #1a1a2e 0%, #0a0a0f 70%)',
      }}
    >
      {particles.map((p, i) => {
        const yOffset = (frame * p.speed) % 110;
        const currentY = ((p.y + yOffset) % 110) - 5;
        const xWobble = Math.sin(frame * 0.02 + i) * 2;

        return (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: `${p.x + xWobble}%`,
              top: `${currentY}%`,
              width: p.size,
              height: p.size,
              borderRadius: '50%',
              backgroundColor: `rgba(255, 255, 255, ${p.opacity})`,
              pointerEvents: 'none',
            }}
          />
        );
      })}
      {children}
    </AbsoluteFill>
  );
};
