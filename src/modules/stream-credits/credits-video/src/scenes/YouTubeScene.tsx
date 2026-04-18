import React from 'react';
import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { SectionTitle } from '../components/SectionTitle';
import type { YouTubeData } from '../types';

interface YouTubeSceneProps {
  youtubeData: YouTubeData;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

const StatBox: React.FC<{
  label: string;
  value: string;
  index: number;
  gradient: string;
}> = ({ label, value, index, gradient }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const scale = spring({
    frame: frame - 20 - index * 8,
    fps,
    config: { damping: 12, stiffness: 80 },
  });

  return (
    <div
      style={{
        textAlign: 'center',
        transform: `scale(${scale})`,
        opacity: scale,
      }}
    >
      <div
        style={{
          fontSize: 56,
          fontWeight: 800,
          fontFamily: 'Inter, sans-serif',
          background: gradient,
          backgroundClip: 'text',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 400,
          fontFamily: 'Inter, sans-serif',
          color: 'rgba(255, 255, 255, 0.5)',
          letterSpacing: 3,
          textTransform: 'uppercase',
          marginTop: 8,
        }}
      >
        {label}
      </div>
    </div>
  );
};

export const YouTubeScene: React.FC<YouTubeSceneProps> = ({ youtubeData }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { channel, recentVideos } = youtubeData;

  // Channel thumbnail entrance
  const thumbScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80, mass: 1 },
  });

  // Videos slide in
  const videosY = interpolate(frame, [60, 90], [100, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const videosOpacity = interpolate(frame, [60, 80], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <SectionTitle
        text="YouTube"
        gradient="linear-gradient(90deg, #FF0000, #ff4444, #ff6b6b)"
      />

      {/* Channel info */}
      <div
        style={{
          position: 'absolute',
          top: 140,
          left: 0,
          right: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
        }}
      >
        {/* Channel thumbnail */}
        {channel.channelThumbnail && (
          <div
            style={{
              width: 120,
              height: 120,
              borderRadius: '50%',
              overflow: 'hidden',
              border: '3px solid rgba(255, 0, 0, 0.5)',
              boxShadow: '0 0 30px rgba(255, 0, 0, 0.3)',
              transform: `scale(${thumbScale})`,
            }}
          >
            <img
              src={channel.channelThumbnail}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        )}

        {/* Channel name */}
        <div
          style={{
            fontSize: 36,
            fontWeight: 700,
            fontFamily: 'Inter, sans-serif',
            color: '#ffffff',
            opacity: thumbScale,
          }}
        >
          {channel.channelName}
        </div>

        {/* Stats row */}
        <div
          style={{
            display: 'flex',
            gap: 80,
            marginTop: 10,
          }}
        >
          <StatBox
            label="Subscribers"
            value={formatCount(channel.subscriberCount)}
            index={0}
            gradient="linear-gradient(90deg, #FF0000, #ff4444)"
          />
          <StatBox
            label="Total Views"
            value={formatCount(channel.viewCount)}
            index={1}
            gradient="linear-gradient(90deg, #ff4444, #ff6b6b)"
          />
          <StatBox
            label="Videos"
            value={formatCount(channel.videoCount)}
            index={2}
            gradient="linear-gradient(90deg, #ff6b6b, #ff9999)"
          />
        </div>
      </div>

      {/* Recent videos */}
      {recentVideos.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 100,
            right: 100,
            opacity: videosOpacity,
            transform: `translateY(${videosY}px)`,
          }}
        >
          <div
            style={{
              fontSize: 18,
              fontWeight: 600,
              fontFamily: 'Inter, sans-serif',
              color: 'rgba(255, 255, 255, 0.5)',
              letterSpacing: 3,
              textTransform: 'uppercase',
              marginBottom: 20,
              textAlign: 'center',
            }}
          >
            Recent Uploads
          </div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              gap: 30,
            }}
          >
            {recentVideos.slice(0, 4).map((video, i) => {
              const cardScale = spring({
                frame: frame - 70 - i * 6,
                fps,
                config: { damping: 14, stiffness: 70 },
              });

              return (
                <div
                  key={i}
                  style={{
                    width: 360,
                    transform: `scale(${cardScale})`,
                    opacity: cardScale,
                  }}
                >
                  {video.thumbnailUrl && (
                    <div
                      style={{
                        width: '100%',
                        height: 200,
                        borderRadius: 12,
                        overflow: 'hidden',
                        marginBottom: 12,
                        border: '1px solid rgba(255,255,255,0.1)',
                      }}
                    >
                      <img
                        src={video.thumbnailUrl}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 15,
                      fontWeight: 600,
                      fontFamily: 'Inter, sans-serif',
                      color: 'rgba(255, 255, 255, 0.85)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {video.title}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontFamily: 'Inter, sans-serif',
                      color: 'rgba(255, 255, 255, 0.4)',
                      marginTop: 4,
                    }}
                  >
                    {formatCount(video.viewCount)} views &middot;{' '}
                    {formatCount(video.likeCount)} likes
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
