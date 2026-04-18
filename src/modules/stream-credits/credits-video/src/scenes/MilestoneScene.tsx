import React from 'react';
import {
  AbsoluteFill,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { SectionTitle } from '../components/SectionTitle';
import type { GrowthStats } from '../types';

interface MilestoneSceneProps {
  growthData: GrowthStats;
  guildName: string;
}

interface Milestone {
  label: string;
  date: string;
  members: number;
}

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function formatDate(dateStr: string): string {
  const parts = dateStr.split('-');
  return `${monthNames[parseInt(parts[1]!) - 1]} ${parseInt(parts[2]!)}, ${parts[0]}`;
}

function buildMilestones(timeline: GrowthStats['timeline']): Milestone[] {
  const thresholds = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  const milestones: Milestone[] = [];
  const maxMembers = timeline.length > 0 ? timeline[timeline.length - 1]!.totalMembers : 0;

  for (const t of thresholds) {
    if (t > maxMembers) break;
    const point = timeline.find((p) => p.totalMembers >= t);
    if (point) {
      milestones.push({
        label: `${t.toLocaleString()} Members`,
        date: point.date,
        members: t,
      });
    }
  }

  return milestones;
}

const gradientColors = [
  '#5865F2', '#7289da', '#c44dff', '#ff6b9d',
  '#ff9800', '#ffc107', '#00d2d3', '#54e3e4',
  '#ff5722', '#e91e63',
];

export const MilestoneScene: React.FC<MilestoneSceneProps> = ({
  growthData,
  guildName,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  const milestones = buildMilestones(growthData.timeline);

  if (milestones.length === 0) {
    return (
      <AbsoluteFill style={{ justifyContent: 'center', alignItems: 'center' }}>
        <SectionTitle
          text="Milestones"
          gradient="linear-gradient(90deg, #ffc107, #ff6b9d)"
        />
      </AbsoluteFill>
    );
  }

  // Timeline layout
  const lineY = 540; // Center of screen
  const lineLeft = 200;
  const lineRight = 1720;
  const lineWidth = lineRight - lineLeft;

  // Animate the timeline line drawing
  const lineProgress = interpolate(frame, [15, 60], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      <SectionTitle
        text={`${guildName} Milestones`}
        gradient="linear-gradient(90deg, #ffc107, #ff6b9d, #c44dff)"
      />

      {/* Timeline line */}
      <svg
        width={1920}
        height={1080}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        <defs>
          <linearGradient id="timelineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#5865F2" />
            <stop offset="50%" stopColor="#c44dff" />
            <stop offset="100%" stopColor="#ff6b9d" />
          </linearGradient>
        </defs>
        <line
          x1={lineLeft}
          y1={lineY}
          x2={lineLeft + lineWidth * lineProgress}
          y2={lineY}
          stroke="url(#timelineGrad)"
          strokeWidth={3}
          strokeLinecap="round"
        />
      </svg>

      {/* Milestone markers */}
      {milestones.map((milestone, i) => {
        const x =
          lineLeft + (i / Math.max(1, milestones.length - 1)) * lineWidth;
        const isAbove = i % 2 === 0;

        const entryDelay = 20 + i * 10;
        const markerScale = spring({
          frame: frame - entryDelay,
          fps,
          config: { damping: 12, stiffness: 70 },
        });

        const dotPulse = Math.sin((frame - entryDelay) * 0.08) * 0.15 + 1;
        const color = gradientColors[i % gradientColors.length]!;

        return (
          <React.Fragment key={i}>
            {/* Dot on line */}
            <div
              style={{
                position: 'absolute',
                left: x - 8,
                top: lineY - 8,
                width: 16,
                height: 16,
                borderRadius: '50%',
                backgroundColor: color,
                boxShadow: `0 0 15px ${color}80`,
                transform: `scale(${markerScale * dotPulse})`,
              }}
            />

            {/* Connector line */}
            <div
              style={{
                position: 'absolute',
                left: x - 1,
                top: isAbove ? lineY - 120 : lineY + 16,
                width: 2,
                height: 104,
                backgroundColor: `${color}60`,
                transform: `scaleY(${markerScale})`,
                transformOrigin: isAbove ? 'bottom' : 'top',
              }}
            />

            {/* Label */}
            <div
              style={{
                position: 'absolute',
                left: x,
                top: isAbove ? lineY - 200 : lineY + 130,
                transform: `translateX(-50%) scale(${markerScale})`,
                textAlign: 'center',
                opacity: markerScale,
              }}
            >
              <div
                style={{
                  fontSize: 24,
                  fontWeight: 800,
                  fontFamily: 'Inter, sans-serif',
                  color,
                  textShadow: `0 0 20px ${color}40`,
                  whiteSpace: 'nowrap',
                }}
              >
                {milestone.label}
              </div>
              <div
                style={{
                  fontSize: 14,
                  fontFamily: 'Inter, sans-serif',
                  color: 'rgba(255, 255, 255, 0.45)',
                  marginTop: 4,
                }}
              >
                {formatDate(milestone.date)}
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </AbsoluteFill>
  );
};
