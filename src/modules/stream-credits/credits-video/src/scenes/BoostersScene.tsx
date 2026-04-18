import React from 'react';
import { AbsoluteFill } from 'remotion';
import { SectionTitle } from '../components/SectionTitle';
import { FloatingProfiles } from '../components/FloatingProfiles';
import type { CreditsMember } from '../types';

interface BoostersSceneProps {
  boosters: CreditsMember[];
}

export const BoostersScene: React.FC<BoostersSceneProps> = ({ boosters }) => {
  return (
    <AbsoluteFill>
      <SectionTitle
        text="Special Thanks to Our Boosters"
        gradient="linear-gradient(90deg, #ff6b9d, #ff9ff3, #c44dff)"
      />
      <FloatingProfiles
        members={boosters}
        variant="booster"
        staggerFrames={6}
      />
    </AbsoluteFill>
  );
};
