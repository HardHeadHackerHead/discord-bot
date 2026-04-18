import React from 'react';
import { Audio, AbsoluteFill, staticFile } from 'remotion';
import {
  TransitionSeries,
  linearTiming,
} from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { ParticleBackground } from './components/ParticleBackground';
import { IntroScene } from './scenes/IntroScene';
import { BoostersScene } from './scenes/BoostersScene';
import { SupportersScene } from './scenes/SupportersScene';
import { GrowthScene } from './scenes/GrowthScene';
import { AllMembersScene } from './scenes/AllMembersScene';
import { ActivityScene } from './scenes/ActivityScene';
import { YouTubeScene } from './scenes/YouTubeScene';
import { MilestoneScene } from './scenes/MilestoneScene';
import { NewThisWeekScene } from './scenes/NewThisWeekScene';
import { OutroScene } from './scenes/OutroScene';
import type { CreditsVideoProps } from './types';
import './styles/global.css';

// Transition duration in frames (crossfade overlap)
const TRANSITION_FRAMES = 20;

// Scene durations (in frames at 30fps)
const INTRO_FRAMES = 180;
const MIN_SECTION_FRAMES = 240;
const GROWTH_FRAMES = 450;
const MILESTONE_FRAMES = 300;
const ACTIVITY_FRAMES = 360;
const YOUTUBE_FRAMES = 360;
const NEW_MEMBERS_FRAMES = 240;
const OUTRO_FRAMES = 360;
const FRAMES_PER_MEMBER = 10;
const SCROLL_FRAMES_PER_MEMBER = 4;
const MIN_ALL_MEMBERS_FRAMES = 360;

interface SceneSpec {
  key: string;
  frames: number;
  render: () => React.ReactNode;
}

function buildScenes(props: CreditsVideoProps): SceneSpec[] {
  const scenes: SceneSpec[] = [];

  // 1. Intro
  scenes.push({
    key: 'intro',
    frames: INTRO_FRAMES,
    render: () => (
      <IntroScene
        guildName={props.guildName}
        guildIconUrl={props.guildIconUrl}
      />
    ),
  });

  // 2. Boosters
  if (props.boosters.length > 0) {
    scenes.push({
      key: 'boosters',
      frames: Math.max(
        MIN_SECTION_FRAMES,
        props.boosters.length * FRAMES_PER_MEMBER + 90
      ),
      render: () => <BoostersScene boosters={props.boosters} />,
    });
  }

  // 3. Supporters
  if (props.tagWearers.length > 0) {
    scenes.push({
      key: 'supporters',
      frames: Math.max(
        MIN_SECTION_FRAMES,
        props.tagWearers.length * FRAMES_PER_MEMBER + 90
      ),
      render: () => <SupportersScene tagWearers={props.tagWearers} />,
    });
  }

  // 4. Activity stats
  if (props.activityStats && props.activityStats.topMembers.length > 0) {
    scenes.push({
      key: 'activity',
      frames: ACTIVITY_FRAMES,
      render: () => (
        <ActivityScene activityStats={props.activityStats!} />
      ),
    });
  }

  // 5. Growth chart
  if (props.growthData.timeline.length > 0) {
    scenes.push({
      key: 'growth',
      frames: GROWTH_FRAMES,
      render: () => (
        <GrowthScene
          growthData={props.growthData}
          guildName={props.guildName}
        />
      ),
    });
  }

  // 6. Milestones
  if (props.growthData.timeline.length > 0) {
    scenes.push({
      key: 'milestones',
      frames: MILESTONE_FRAMES,
      render: () => (
        <MilestoneScene
          growthData={props.growthData}
          guildName={props.guildName}
        />
      ),
    });
  }

  // 7. YouTube
  if (props.youtubeData) {
    scenes.push({
      key: 'youtube',
      frames: YOUTUBE_FRAMES,
      render: () => <YouTubeScene youtubeData={props.youtubeData!} />,
    });
  }

  // 8. New members this week
  if (props.newMembers && props.newMembers.length > 0) {
    scenes.push({
      key: 'new-members',
      frames: NEW_MEMBERS_FRAMES,
      render: () => <NewThisWeekScene newMembers={props.newMembers!} />,
    });
  }

  // 9. All members scroll
  if (props.allMembers.length > 0) {
    scenes.push({
      key: 'all-members',
      frames: Math.max(
        MIN_ALL_MEMBERS_FRAMES,
        props.allMembers.length * SCROLL_FRAMES_PER_MEMBER + 120
      ),
      render: () => <AllMembersScene members={props.allMembers} />,
    });
  }

  // 10. Outro
  scenes.push({
    key: 'outro',
    frames: OUTRO_FRAMES,
    render: () => <OutroScene members={props.allMembers} />,
  });

  return scenes;
}

/**
 * Calculate the natural content duration (sum of scenes minus transition overlaps).
 * Used as a fallback when audio duration is not available.
 */
export function calculateContentDuration(props: CreditsVideoProps): number {
  const scenes = buildScenes(props);
  const totalSceneFrames = scenes.reduce((sum, s) => sum + s.frames, 0);
  const transitionCount = Math.max(0, scenes.length - 1);
  return totalSceneFrames - transitionCount * TRANSITION_FRAMES;
}

/**
 * Calculate the final video duration.
 * If audioDurationFrames is provided (from the audio file), we stretch/compress
 * scenes proportionally to match the audio length.
 */
export function calculateDuration(
  props: CreditsVideoProps,
  audioDurationFrames?: number
): number {
  if (audioDurationFrames && audioDurationFrames > 0) {
    return audioDurationFrames;
  }
  return calculateContentDuration(props);
}

export const CreditsVideo: React.FC<
  CreditsVideoProps & { audioDurationFrames?: number }
> = (props) => {
  const {
    audioDurationFrames,
    ...videoProps
  } = props;

  const scenes = buildScenes(videoProps);

  // If we have a target audio duration, scale all scene durations proportionally
  const contentDuration = calculateContentDuration(videoProps);
  const targetDuration = audioDurationFrames && audioDurationFrames > 0
    ? audioDurationFrames
    : contentDuration;
  const scale = targetDuration / contentDuration;

  const scaledScenes = scenes.map((s) => ({
    ...s,
    frames: Math.round(s.frames * scale),
  }));

  // Audio source — use provided or fall back to the bundled song
  const audioSource =
    videoProps.audioSrc ||
    staticFile('stream-credits/Till I Log Off - QuadsLab.mp3');

  return (
    <ParticleBackground>
      {/* Background music */}
      <Audio src={audioSource} volume={0.3} />

      <TransitionSeries>
        {scaledScenes.map((scene, i) => (
          <React.Fragment key={scene.key}>
            <TransitionSeries.Sequence durationInFrames={scene.frames}>
              <AbsoluteFill>{scene.render()}</AbsoluteFill>
            </TransitionSeries.Sequence>
            {i < scaledScenes.length - 1 && (
              <TransitionSeries.Transition
                presentation={fade()}
                timing={linearTiming({
                  durationInFrames: TRANSITION_FRAMES,
                })}
              />
            )}
          </React.Fragment>
        ))}
      </TransitionSeries>
    </ParticleBackground>
  );
};
