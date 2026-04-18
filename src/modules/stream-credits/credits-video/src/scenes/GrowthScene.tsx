import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from 'remotion';
import { SectionTitle } from '../components/SectionTitle';
import type { GrowthStats } from '../types';

interface GrowthSceneProps {
  growthData: GrowthStats;
  guildName: string;
}

const CHART_LEFT = 200;
const CHART_RIGHT = 1720;
const CHART_TOP = 180;
const CHART_BOTTOM = 750;
const CHART_WIDTH = CHART_RIGHT - CHART_LEFT;
const CHART_HEIGHT = CHART_BOTTOM - CHART_TOP;

const monthNames = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

// Build a smooth cubic bezier SVG path through points using Catmull-Rom → cubic bezier conversion
function buildSmoothPath(
  points: { x: number; y: number }[]
): { linePath: string; areaPath: string } {
  if (points.length === 0) return { linePath: '', areaPath: '' };
  if (points.length === 1) {
    return {
      linePath: `M ${points[0]!.x} ${points[0]!.y}`,
      areaPath: `M ${points[0]!.x} ${points[0]!.y} L ${points[0]!.x} ${CHART_BOTTOM} Z`,
    };
  }

  // For 2 points, just a straight line
  if (points.length === 2) {
    const line = `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
    const area = `${line} L ${points[1]!.x} ${CHART_BOTTOM} L ${points[0]!.x} ${CHART_BOTTOM} Z`;
    return { linePath: line, areaPath: area };
  }

  // Catmull-Rom to cubic bezier
  const tension = 0.3;
  let d = `M ${points[0]!.x} ${points[0]!.y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
  }

  const lastPt = points[points.length - 1]!;
  const firstPt = points[0]!;
  const area = `${d} L ${lastPt.x} ${CHART_BOTTOM} L ${firstPt.x} ${CHART_BOTTOM} Z`;

  return { linePath: d, areaPath: area };
}

// Downsample timeline for rendering — we don't need 1000+ SVG points
function downsampleTimeline(
  timeline: GrowthStats['timeline'],
  maxPoints: number
): GrowthStats['timeline'] {
  if (timeline.length <= maxPoints) return timeline;

  const step = (timeline.length - 1) / (maxPoints - 1);
  const result: GrowthStats['timeline'] = [];
  for (let i = 0; i < maxPoints - 1; i++) {
    result.push(timeline[Math.round(i * step)]!);
  }
  result.push(timeline[timeline.length - 1]!); // Always include last point
  return result;
}

export const GrowthScene: React.FC<GrowthSceneProps> = ({
  growthData,
  guildName,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  const { timeline, totalMembers } = growthData;

  if (timeline.length === 0) {
    return (
      <AbsoluteFill
        style={{ justifyContent: 'center', alignItems: 'center' }}
      >
        <SectionTitle
          text="Server Growth"
          gradient="linear-gradient(90deg, #5865F2, #c44dff, #ff6b9d)"
        />
      </AbsoluteFill>
    );
  }

  // Downsample to max ~200 points for smooth curves
  const sampledTimeline = downsampleTimeline(timeline, 200);

  const maxMembers = Math.max(...sampledTimeline.map((d) => d.totalMembers));

  // Animate line drawing over the first ~70% of the scene, then hold
  const drawEndFrame = Math.floor(durationInFrames * 0.7);
  const drawProgress = interpolate(frame, [20, drawEndFrame], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Build chart points
  const allPoints = sampledTimeline.map((d, i) => {
    const x =
      CHART_LEFT +
      (i / Math.max(1, sampledTimeline.length - 1)) * CHART_WIDTH;
    const y = CHART_BOTTOM - (d.totalMembers / maxMembers) * CHART_HEIGHT;
    return { x, y, ...d };
  });

  // How many points to draw based on progress
  const visibleCount = Math.max(
    2,
    Math.ceil(drawProgress * allPoints.length)
  );
  const visiblePoints = allPoints.slice(0, visibleCount);

  // The current member count follows the line tip
  const currentPoint = visiblePoints[visiblePoints.length - 1]!;
  const counterValue = currentPoint.totalMembers;

  // Build smooth SVG path using bezier curves
  const { linePath, areaPath } = buildSmoothPath(visiblePoints);

  // Y-axis labels
  const yAxisSteps = 5;
  const yLabels = Array.from({ length: yAxisSteps + 1 }, (_, i) => {
    const val = Math.round((maxMembers / yAxisSteps) * i);
    const y = CHART_BOTTOM - (i / yAxisSteps) * CHART_HEIGHT;
    return { val, y };
  });

  // X-axis labels — show ~8 evenly spaced dates
  const labelInterval = Math.max(
    1,
    Math.floor(sampledTimeline.length / 8)
  );
  const xLabels: { x: number; label: string }[] = [];
  for (let i = 0; i < sampledTimeline.length; i++) {
    if (
      i % labelInterval === 0 ||
      i === sampledTimeline.length - 1
    ) {
      const d = sampledTimeline[i]!;
      const x =
        CHART_LEFT +
        (i / Math.max(1, sampledTimeline.length - 1)) * CHART_WIDTH;
      const parts = d.date.split('-');
      const label = `${monthNames[parseInt(parts[1]!) - 1]} '${parts[0]!.slice(2)}`;
      if (
        xLabels.length === 0 ||
        xLabels[xLabels.length - 1]!.label !== label
      ) {
        xLabels.push({ x, label });
      }
    }
  }

  // Date label at tip of the line
  const tipDateParts = currentPoint.date.split('-');
  const tipDateLabel = `${monthNames[parseInt(tipDateParts[1]!) - 1]} ${tipDateParts[2]}, ${tipDateParts[0]}`;

  // Stats row opacity
  const statsOpacity = interpolate(frame, [40, 60], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Milestone pops
  const milestones = [50, 100, 250, 500, 1000, 2500, 5000, 10000].filter(
    (m) => m <= maxMembers && m >= Math.round(maxMembers * 0.1)
  );

  const activeMilestone = milestones
    .filter((m) => counterValue >= m)
    .pop();

  const milestoneIndex = activeMilestone
    ? allPoints.findIndex((p) => p.totalMembers >= activeMilestone)
    : -1;
  const milestoneFrame =
    milestoneIndex >= 0
      ? 20 +
        (milestoneIndex / allPoints.length) * (drawEndFrame - 20)
      : -999;
  const milestoneOpacity = interpolate(
    frame,
    [
      milestoneFrame,
      milestoneFrame + 5,
      milestoneFrame + 40,
      milestoneFrame + 60,
    ],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
  );

  return (
    <AbsoluteFill>
      <SectionTitle
        text={`${guildName} Growth`}
        gradient="linear-gradient(90deg, #5865F2, #c44dff, #ff6b9d)"
      />

      {/* Chart */}
      <svg
        width={1920}
        height={1080}
        style={{ position: 'absolute', top: 0, left: 0 }}
      >
        {/* Grid lines */}
        {yLabels.map(({ val, y }, i) => (
          <g key={i}>
            <line
              x1={CHART_LEFT}
              y1={y}
              x2={CHART_RIGHT}
              y2={y}
              stroke="rgba(255,255,255,0.08)"
              strokeWidth={1}
            />
            <text
              x={CHART_LEFT - 15}
              y={y + 5}
              fill="rgba(255,255,255,0.4)"
              fontSize={14}
              fontFamily="Inter, sans-serif"
              textAnchor="end"
            >
              {val.toLocaleString()}
            </text>
          </g>
        ))}

        {/* X-axis labels */}
        {xLabels.map(({ x, label }, i) => (
          <text
            key={i}
            x={x}
            y={CHART_BOTTOM + 30}
            fill="rgba(255,255,255,0.4)"
            fontSize={13}
            fontFamily="Inter, sans-serif"
            textAnchor="middle"
          >
            {label}
          </text>
        ))}

        {/* Gradients */}
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(136, 100, 255, 0.3)" />
            <stop offset="100%" stopColor="rgba(136, 100, 255, 0)" />
          </linearGradient>
          <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#5865F2" />
            <stop offset="50%" stopColor="#c44dff" />
            <stop offset="100%" stopColor="#ff6b9d" />
          </linearGradient>
        </defs>

        {areaPath && <path d={areaPath} fill="url(#areaGrad)" />}
        {linePath && (
          <path
            d={linePath}
            fill="none"
            stroke="url(#lineGrad)"
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Glow dot at tip */}
        {visiblePoints.length > 0 && (
          <>
            <circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r={10}
              fill="rgba(196, 77, 255, 0.3)"
            />
            <circle
              cx={currentPoint.x}
              cy={currentPoint.y}
              r={5}
              fill="#c44dff"
            />
          </>
        )}
      </svg>

      {/* Live counter that tracks the line tip */}
      <div
        style={{
          position: 'absolute',
          top: 100,
          right: 120,
          textAlign: 'right',
          opacity: statsOpacity,
        }}
      >
        <div
          style={{
            fontSize: 80,
            fontWeight: 800,
            fontFamily: 'Inter, sans-serif',
            background: 'linear-gradient(90deg, #5865F2, #c44dff)',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            lineHeight: 1,
          }}
        >
          {counterValue.toLocaleString()}
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
          Members
        </div>
        <div
          style={{
            fontSize: 14,
            fontWeight: 400,
            fontFamily: 'Inter, sans-serif',
            color: 'rgba(255, 255, 255, 0.35)',
            marginTop: 4,
          }}
        >
          {tipDateLabel}
        </div>
      </div>

      {/* Milestone flash */}
      {activeMilestone && milestoneOpacity > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 200,
            left: 0,
            right: 0,
            display: 'flex',
            justifyContent: 'center',
            opacity: milestoneOpacity,
          }}
        >
          <div
            style={{
              fontSize: 36,
              fontWeight: 800,
              fontFamily: 'Inter, sans-serif',
              background: 'linear-gradient(90deg, #ff6b9d, #c44dff)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              textShadow: 'none',
              letterSpacing: 2,
            }}
          >
            {activeMilestone.toLocaleString()} MEMBERS!
          </div>
        </div>
      )}

      {/* Bottom stats — shown after draw completes */}
      <div
        style={{
          position: 'absolute',
          bottom: 100,
          left: 0,
          right: 0,
          display: 'flex',
          justifyContent: 'center',
          gap: 100,
          opacity: interpolate(
            frame,
            [drawEndFrame, drawEndFrame + 20],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
          ),
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 48,
              fontWeight: 800,
              fontFamily: 'Inter, sans-serif',
              background: 'linear-gradient(90deg, #5865F2, #c44dff)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {totalMembers.toLocaleString()}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 400,
              fontFamily: 'Inter, sans-serif',
              color: 'rgba(255, 255, 255, 0.5)',
              letterSpacing: 3,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            Total Members
          </div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontSize: 48,
              fontWeight: 800,
              fontFamily: 'Inter, sans-serif',
              background: 'linear-gradient(90deg, #c44dff, #ff6b9d)',
              backgroundClip: 'text',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            {timeline.length}
          </div>
          <div
            style={{
              fontSize: 16,
              fontWeight: 400,
              fontFamily: 'Inter, sans-serif',
              color: 'rgba(255, 255, 255, 0.5)',
              letterSpacing: 3,
              textTransform: 'uppercase',
              marginTop: 4,
            }}
          >
            Days Tracked
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
