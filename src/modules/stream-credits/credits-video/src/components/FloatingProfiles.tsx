import React from 'react';
import { AbsoluteFill } from 'remotion';
import { ProfileCard } from './ProfileCard';
import type { CreditsMember } from '../types';

interface FloatingProfilesProps {
  members: CreditsMember[];
  variant: 'booster' | 'supporter';
  staggerFrames?: number;
}

/**
 * Dynamically distributes members into balanced rows.
 * For 6 members: 3+3. For 7: 4+3. For 5: 3+2. Etc.
 */
function getBalancedColumns(count: number): number {
  if (count <= 3) return count;
  if (count <= 4) return 2;
  if (count <= 6) return 3;
  if (count <= 9) return Math.ceil(count / 2);
  if (count <= 16) return Math.ceil(count / 3);
  return Math.min(6, Math.ceil(Math.sqrt(count)));
}

export const FloatingProfiles: React.FC<FloatingProfilesProps> = ({
  members,
  variant,
  staggerFrames = 6,
}) => {
  const columns = getBalancedColumns(members.length);

  // Build rows for balanced distribution
  const rows: CreditsMember[][] = [];
  let remaining = [...members];
  const totalRows = Math.ceil(members.length / columns);

  for (let r = 0; r < totalRows; r++) {
    // Distribute evenly: some rows get ceil, some get floor
    const rowsLeft = totalRows - r;
    const itemsThisRow = Math.ceil(remaining.length / rowsLeft);
    rows.push(remaining.slice(0, itemsThisRow));
    remaining = remaining.slice(itemsThisRow);
  }

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '120px 80px 40px',
        gap: 30,
      }}
    >
      {rows.map((row, rowIdx) => (
        <div
          key={rowIdx}
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 40,
          }}
        >
          {row.map((member, colIdx) => {
            const globalIdx =
              rows.slice(0, rowIdx).reduce((s, r) => s + r.length, 0) + colIdx;
            return (
              <ProfileCard
                key={member.userId}
                avatarUrl={member.avatarUrl}
                displayName={member.displayName}
                variant={variant}
                delay={globalIdx * staggerFrames}
              />
            );
          })}
        </div>
      ))}
    </AbsoluteFill>
  );
};
