import React from 'react';
import {
  AbsoluteFill,
  Img,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  staticFile,
} from 'remotion';
import type { CreditsMember } from '../types';

interface OutroSceneProps {
  members: CreditsMember[];
}

export const OutroScene: React.FC<OutroSceneProps> = ({ members }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const profilePic = staticFile('stream-credits/Profile Pic.png');

  // Profile pic + text entrance
  const textScale = spring({
    frame: frame - 15,
    fps,
    config: { damping: 12, stiffness: 80, mass: 1 },
  });

  const textOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade to black — just the final 2 seconds
  const fadeToBlack = interpolate(
    frame,
    [durationInFrames - 60, durationInFrames],
    [0, 1],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  // Use up to 30 orbiting avatars across multiple rings
  const orbitMembers = members.slice(0, 30);

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {/* Orbiting avatars — two rings */}
      {orbitMembers.map((member, i) => {
        const ring = i < 15 ? 0 : 1;
        const ringIndex = ring === 0 ? i : i - 15;
        const ringCount = ring === 0 ? Math.min(15, orbitMembers.length) : orbitMembers.length - 15;

        const baseRadius = ring === 0 ? 320 : 220;
        const avatarSize = ring === 0 ? 50 : 40;
        const angleOffset = (ringIndex / ringCount) * Math.PI * 2;
        const direction = ring === 0 ? 1 : -1; // Inner ring orbits opposite
        const speed = (0.012 + (i % 4) * 0.003) * direction;
        const angle = angleOffset + frame * speed;
        const radiusVariation = baseRadius + (i % 3 === 0 ? 20 : i % 3 === 1 ? -15 : 0);

        const x = Math.cos(angle) * radiusVariation;
        const y = Math.sin(angle) * radiusVariation * 0.55; // Elliptical

        const entryProgress = spring({
          frame: frame - i * 2,
          fps,
          config: { damping: 18, stiffness: 50 },
        });

        if (entryProgress < 0.01) return null;

        return (
          <div
            key={member.userId}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${entryProgress})`,
              width: avatarSize,
              height: avatarSize,
              borderRadius: '50%',
              overflow: 'hidden',
              border: `2px solid rgba(255,255,255,${ring === 0 ? 0.3 : 0.2})`,
              boxShadow: `0 0 ${ring === 0 ? 15 : 10}px rgba(136, 100, 255, ${ring === 0 ? 0.4 : 0.25})`,
            }}
          >
            <Img
              src={member.avatarUrl}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        );
      })}

      {/* Center content — profile pic + thank you */}
      <div
        style={{
          transform: `scale(${textScale})`,
          opacity: textOpacity,
          textAlign: 'center',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        {/* Host profile pic — larger */}
        <div
          style={{
            width: 140,
            height: 140,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '4px solid rgba(196, 77, 255, 0.6)',
            boxShadow:
              '0 0 40px rgba(196, 77, 255, 0.5), 0 0 80px rgba(196, 77, 255, 0.2)',
          }}
        >
          <Img
            src={profilePic}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </div>
        <div
          style={{
            fontSize: 80,
            fontWeight: 800,
            fontFamily: 'Inter, sans-serif',
            background: 'linear-gradient(90deg, #ff6b9d, #c44dff, #00d2d3)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: -2,
          }}
        >
          Thank You
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 400,
            fontFamily: 'Inter, sans-serif',
            color: 'rgba(255, 255, 255, 0.5)',
            letterSpacing: 6,
            textTransform: 'uppercase',
          }}
        >
          For Your Support
        </div>
      </div>

      {/* Fade to black */}
      <AbsoluteFill
        style={{
          backgroundColor: '#000',
          opacity: fadeToBlack,
        }}
      />
    </AbsoluteFill>
  );
};
