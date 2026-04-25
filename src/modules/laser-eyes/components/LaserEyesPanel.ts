import {
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { GLOW_COLORS } from '../services/LaserEyesService.js';

/** Per-message panel state — stored in-memory keyed by message ID. */
export interface LaserEyesPanelState {
  /** URL of the original (un-lasered) source image, used to re-render. */
  sourceUrl: string;
  /** Currently selected glow color: a key of GLOW_COLORS, '_random', or '#hex'. */
  colorChoice: string;
  /** Resolved hex color in use right now (after random rolls etc.). */
  hexColor: string;
  /** Currently selected deepfry intensity: '0' / '0.15' / '0.3' / '0.5' / '0.75' / '1'. */
  fryIntensity: number;
  /** Discord user ID who created this panel — only they can modify it. */
  requesterId: string;
  /** Human-readable label for the source ("your avatar", "this image", etc.). */
  label: string;
  /**
   * Whether the most recent render had detectable eyes. When false, the color
   * select still appears but doesn't actually do anything visible (no laser).
   */
  eyesDetected: boolean;
  /** When this state was last touched. Used by the TTL cleanup sweep. */
  lastTouched: number;
}

const FRY_LEVELS: { label: string; value: string; intensity: number }[] = [
  { label: 'Off',          value: '0',    intensity: 0    },
  { label: 'Light (15%)',  value: '0.15', intensity: 0.15 },
  { label: 'Medium (30%)', value: '0.3',  intensity: 0.3  },
  { label: 'Hot (50%)',    value: '0.5',  intensity: 0.5  },
  { label: 'Crispy (75%)', value: '0.75', intensity: 0.75 },
  { label: 'MAX (100%)',   value: '1',    intensity: 1    },
];

export const FRY_INTENSITY_VALUES = FRY_LEVELS.map(l => l.value);

/** Look up a fry-level entry by the select option's value. */
export function fryLevelByValue(value: string): { label: string; intensity: number } | null {
  const found = FRY_LEVELS.find(l => l.value === value);
  return found ? { label: found.label, intensity: found.intensity } : null;
}

export const COLOR_RANDOM_VALUE = '_random';

export class LaserEyesPanel {
  /**
   * Build the action rows of select menus for the panel. Selects are
   * pre-populated with the user's current choices so the UI reflects state.
   * The color row is omitted when no eyes were detected — picking a glow
   * color is meaningless if there are no lasers to color.
   */
  static buildComponents(state: LaserEyesPanelState): ActionRowBuilder<StringSelectMenuBuilder>[] {
    const rows: ActionRowBuilder<StringSelectMenuBuilder>[] = [];

    if (state.eyesDetected) {
      const colorOptions: StringSelectMenuOptionBuilder[] = [];

      colorOptions.push(
        new StringSelectMenuOptionBuilder()
          .setLabel('🎲 Random')
          .setValue(COLOR_RANDOM_VALUE)
          .setDescription('Pick a random preset each time')
          .setDefault(state.colorChoice === COLOR_RANDOM_VALUE)
      );

      for (const name of Object.keys(GLOW_COLORS) as (keyof typeof GLOW_COLORS)[]) {
        colorOptions.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(name.charAt(0).toUpperCase() + name.slice(1))
            .setValue(name)
            .setDefault(state.colorChoice === name)
        );
      }

      const colorSelect = new StringSelectMenuBuilder()
        .setCustomId('lasereyes:color')
        .setPlaceholder('Glow color')
        .addOptions(colorOptions);

      rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(colorSelect));
    }

    const fryOptions = FRY_LEVELS.map(level =>
      new StringSelectMenuOptionBuilder()
        .setLabel(level.label)
        .setValue(level.value)
        .setDefault(state.fryIntensity === level.intensity)
    );

    const fryStr = String(state.fryIntensity);
    const frySelect = new StringSelectMenuBuilder()
      .setCustomId('lasereyes:fry')
      .setPlaceholder(
        FRY_LEVELS.find(l => l.value === fryStr)?.label ?? 'Deepfry intensity'
      )
      .addOptions(fryOptions);

    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(frySelect));

    return rows;
  }

  /** Render the message content line that goes above the image. */
  static buildContent(state: LaserEyesPanelState): string {
    const fryLevel = FRY_LEVELS.find(l => l.intensity === state.fryIntensity);
    const fryNote = state.fryIntensity > 0
      ? ` 🍟 ${fryLevel?.label ?? `${Math.round(state.fryIntensity * 100)}%`}`
      : '';

    if (!state.eyesDetected) {
      // No face detected — color choice doesn't matter, just describe the fry.
      const fryLabel = state.fryIntensity > 0 ? `Fried${fryNote}` : 'Just the image';
      return `🍟 ${fryLabel} on ${state.label}. (no eyes detected — couldn't add lasers)`;
    }

    const colorWord = state.colorChoice === COLOR_RANDOM_VALUE
      ? `random (${describeHex(state.hexColor)})`
      : state.colorChoice;
    return `🔴 ${colorWord} lasers on ${state.label}.${fryNote} ⚡`;
  }
}

/** Show "#abc123" if user picked a custom hex, or the preset name if applicable. */
function describeHex(hex: string): string {
  for (const [name, presetHex] of Object.entries(GLOW_COLORS)) {
    if (presetHex.toLowerCase() === hex.toLowerCase()) return name;
  }
  return hex;
}

/** ============= Module-level state map + TTL cleanup ============= */

const STATE_TTL_MS = 60 * 60 * 1000; // 1 hour

const panelStates = new Map<string, LaserEyesPanelState>();

export function setPanelState(messageId: string, state: LaserEyesPanelState): void {
  state.lastTouched = Date.now();
  panelStates.set(messageId, state);
}

export function getPanelState(messageId: string): LaserEyesPanelState | null {
  const s = panelStates.get(messageId);
  if (!s) return null;
  if (Date.now() - s.lastTouched > STATE_TTL_MS) {
    panelStates.delete(messageId);
    return null;
  }
  s.lastTouched = Date.now();
  return s;
}

export function deletePanelState(messageId: string): void {
  panelStates.delete(messageId);
}

/** Sweep expired states. Called on a timer from the module. */
export function sweepExpiredStates(): number {
  const cutoff = Date.now() - STATE_TTL_MS;
  let removed = 0;
  for (const [id, s] of panelStates) {
    if (s.lastTouched < cutoff) {
      panelStates.delete(id);
      removed++;
    }
  }
  return removed;
}
