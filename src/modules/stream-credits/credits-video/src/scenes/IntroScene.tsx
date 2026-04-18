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

interface IntroSceneProps {
  guildName: string;
  guildIconUrl: string | null;
}

export const IntroScene: React.FC<IntroSceneProps> = ({
  guildName,
  guildIconUrl,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Use static Discord logo from public/stream-credits/
  const logoSrc = staticFile('stream-credits/Discord Logo.png');

  // Logo spring scale-in
  const iconScale = spring({
    frame,
    fps,
    config: { damping: 10, stiffness: 80, mass: 1.2 },
  });

  // Pulsing glow
  const glowPulse = Math.sin(frame * 0.1) * 0.3 + 0.7;

  // Letter-by-letter type-in for server name (starts at frame 30)
  const typeStartFrame = 30;
  const charsPerFrame = 0.4;
  const visibleChars = Math.min(
    guildName.length,
    Math.max(0, Math.floor((frame - typeStartFrame) * charsPerFrame))
  );
  const displayedName = guildName.slice(0, visibleChars);

  // Cursor blink
  const showCursor =
    frame >= typeStartFrame && Math.floor(frame * 0.1) % 2 === 0;

  // Subtitle fade-in
  const subtitleOpacity = interpolate(frame, [80, 100], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        gap: 30,
      }}
    >
      {/* Glow behind logo */}
      <div
        style={{
          position: 'absolute',
          width: 400,
          height: 400,
          borderRadius: 40,
          background: `radial-gradient(circle, rgba(136, 100, 255, ${glowPulse * 0.25}) 0%, transparent 70%)`,
          transform: `scale(${iconScale})`,
          top: '50%',
          left: '50%',
          marginTop: -240,
          marginLeft: -200,
        }}
      />

      {/* Logo — rounded rect, not circle, to preserve corners/text */}
      <div
        style={{
          transform: `scale(${iconScale})`,
          borderRadius: 24,
          overflow: 'hidden',
          width: 240,
          height: 240,
          boxShadow: `0 0 40px rgba(136, 100, 255, ${glowPulse * 0.5})`,
          backgroundColor: '#1a1a2e',
        }}
      >
        <Img
          src={logoSrc}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      </div>

      {/* Server name type-in */}
      <div
        style={{
          fontSize: 56,
          fontWeight: 800,
          fontFamily: 'Inter, sans-serif',
          color: '#ffffff',
          textShadow: '0 0 30px rgba(255,255,255,0.3)',
          letterSpacing: -1,
          minHeight: 70,
        }}
      >
        {displayedName}
        {showCursor && (
          <span style={{ opacity: 0.8, fontWeight: 400 }}>|</span>
        )}
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontSize: 24,
          fontWeight: 400,
          fontFamily: 'Inter, sans-serif',
          color: 'rgba(255, 255, 255, 0.6)',
          opacity: subtitleOpacity,
          letterSpacing: 4,
          textTransform: 'uppercase',
        }}
      >
        Stream Credits
      </div>
    </AbsoluteFill>
  );
};
