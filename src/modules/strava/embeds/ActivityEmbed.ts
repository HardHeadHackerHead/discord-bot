import { EmbedBuilder } from 'discord.js';
import { buildHeartRateChartUrl, buildPaceChartUrl } from './chart-urls.js';

/**
 * Subset of Strava DetailedActivity the bot reads. The website
 * stores this plus an extra `_streams` sibling produced by
 * lib/strava/streams.ts on the website side.
 */
export interface ActivityPayload {
  id: number;
  name: string;
  distance: number;          // meters
  moving_time: number;       // seconds
  elapsed_time: number;
  total_elevation_gain: number; // meters
  type: string;
  sport_type: string;
  start_date_local: string;  // ISO 8601
  average_speed: number;     // m/s
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  has_heartrate?: boolean;
  kudos_count: number;
  achievement_count: number;
  pr_count: number;
  map?: { summary_polyline: string | null };
  photos?: { primary?: { urls?: Record<string, string> } };
  description?: string | null;
  /** Strava marks hidden activities as private; we suppress those. */
  private?: boolean;
  /** Resampled streams produced by the website processor. */
  _streams?: {
    distanceM: number[];
    heartrateBpm: number[] | null;
    velocityMps: number[] | null;
  } | null;
}

export type Units = 'metric' | 'imperial' | 'both' | string;

export interface AthleteDisplay {
  athleteId: bigint | number;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  profilePicUrl: string | null;
}

/**
 * Per-user privacy preferences. Read from StravaIntegration on the
 * website DB at dispatch time, passed in here so this module stays
 * a pure renderer.
 */
export interface PrivacyPrefs {
  privacyMode: 'public' | 'community' | 'private' | string;
  units: Units;
  showHeartRate: boolean;
  showPaceChart: boolean;
}

const STRAVA_ORANGE = 0xFC5200;

const SPORT_EMOJI: Record<string, string> = {
  Run: '🏃',
  TrailRun: '🏃‍♂️',
  VirtualRun: '🏃',
  Ride: '🚴',
  MountainBikeRide: '🚵',
  GravelRide: '🚴',
  VirtualRide: '🚴',
  EBikeRide: '🚴',
  EMountainBikeRide: '🚵',
  Walk: '🚶',
  Hike: '🥾',
  Swim: '🏊',
  Workout: '💪',
  WeightTraining: '🏋️',
  Yoga: '🧘',
  Rowing: '🚣',
  Kayaking: '🛶',
  Canoeing: '🛶',
  StandUpPaddling: '🏄',
  Surfing: '🏄',
  AlpineSki: '⛷️',
  BackcountrySki: '⛷️',
  NordicSki: '⛷️',
  Snowboard: '🏂',
  IceSkate: '⛸️',
  RollerSki: '⛷️',
  Soccer: '⚽',
  Crossfit: '🏋️',
  Elliptical: '🏋️',
  StairStepper: '🪜',
};

function emojiFor(sportType: string, fallback: string): string {
  return SPORT_EMOJI[sportType] ?? SPORT_EMOJI[fallback] ?? '🏅';
}

const METERS_PER_MILE = 1609.344;

function formatDistance(meters: number, type: string, units: Units): string {
  if (type === 'Swim') {
    const m = Math.round(meters);
    const yd = Math.round(meters * 1.09361);
    if (units === 'metric') return `${m} m`;
    if (units === 'imperial') return `${yd} yd`;
    return `${m} m · ${yd} yd`;
  }
  const km = (meters / 1000).toFixed(2);
  const mi = (meters / METERS_PER_MILE).toFixed(2);
  if (units === 'metric') return `${km} km`;
  if (units === 'imperial') return `${mi} mi`;
  return `${km} km · ${mi} mi`;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}m`;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatPaceMinSec(secPerUnit: number): string {
  const m = Math.floor(secPerUnit / 60);
  const s = Math.round(secPerUnit % 60);
  // Carry rollover if rounding pushed seconds to 60.
  if (s === 60) return `${m + 1}:00`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPace(speedMps: number, type: string, units: Units): string {
  if (speedMps <= 0) return '—';

  const PACED_SPORTS = ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'];

  if (type === 'Swim') {
    const per100m = formatPaceMinSec(100 / speedMps);
    const per100yd = formatPaceMinSec(91.44 / speedMps);
    if (units === 'metric') return `${per100m} /100m`;
    if (units === 'imperial') return `${per100yd} /100yd`;
    return `${per100m} /100m · ${per100yd} /100yd`;
  }
  if (PACED_SPORTS.includes(type)) {
    const perKm = formatPaceMinSec(1000 / speedMps);
    const perMi = formatPaceMinSec(METERS_PER_MILE / speedMps);
    if (units === 'metric') return `${perKm} /km`;
    if (units === 'imperial') return `${perMi} /mi`;
    return `${perKm} /km · ${perMi} /mi`;
  }
  // Everything else (Ride, Row, etc.) reads better as speed.
  const kph = (speedMps * 3.6).toFixed(1);
  const mph = (speedMps * 2.23694).toFixed(1);
  if (units === 'metric') return `${kph} km/h`;
  if (units === 'imperial') return `${mph} mph`;
  return `${kph} km/h · ${mph} mph`;
}

function athleteDisplayName(a: AthleteDisplay): string {
  const full = [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (a.username) return a.username;
  return `Athlete #${a.athleteId}`;
}

function activityUrl(activityId: number | bigint): string {
  return `https://www.strava.com/activities/${activityId}`;
}

/**
 * Build the Discord embed(s) for a freshly-completed activity.
 *
 * Returns an array of embeds; Discord renders multi-embed messages as
 * a single message with up to 10 embeds.
 *
 * Layout, by privacy mode:
 *   public / community → [main, heart-rate?]
 *   private            → [main]   (no image, no mention)
 */
export async function buildActivityEmbeds(
  activity: ActivityPayload,
  athlete: AthleteDisplay,
  privacy: PrivacyPrefs,
  discordMention?: string,
): Promise<EmbedBuilder[]> {
  const name = athleteDisplayName(athlete);
  const url = activityUrl(activity.id);
  const sport = activity.sport_type || activity.type;
  const emoji = emojiFor(sport, activity.type);
  const isPrivate = privacy.privacyMode === 'private';

  // Whether to @-mention the user. Hidden in private mode.
  const mention = !isPrivate ? discordMention : undefined;

  // Main embed — title, athlete, stats. No image; the chart embeds
  // carry the visuals (when allowed).
  //
  // The "View on Strava" line is REQUIRED by Strava's brand guidelines
  // whenever we display their data — it must read exactly "View on
  // Strava" and be identifiable as a link. We keep the title itself
  // plain (not hyperlinked) per product preference and satisfy the
  // requirement with this explicit link instead.
  const descLines: string[] = [
    mention
      ? `${mention} just logged a ${sport.toLowerCase()}`
      : `${name} just logged a ${sport.toLowerCase()}`,
  ];
  if (activity.description) descLines.push(activity.description.slice(0, 300));
  descLines.push(`[**View on Strava**](${url})`);
  const description = descLines.join('\n\n');

  // Title is intentionally NOT a link — `.setURL()` would render the
  // activity name as a clickable hyperlink to Strava. The athlete
  // name (setAuthor) keeps its url so that's still clickable.
  const main = new EmbedBuilder()
    .setColor(STRAVA_ORANGE)
    .setTitle(`${emoji} ${activity.name}`)
    .setDescription(description)
    .setAuthor({
      name,
      iconURL: athlete.profilePicUrl ?? undefined,
      url,
    })
    .setTimestamp(new Date(activity.start_date_local))
    .setFooter({ text: 'Powered by Strava' });

  const isSpeedSport = !['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike', 'Swim'].includes(activity.type);

  const fields = [
    { name: 'Distance', value: formatDistance(activity.distance, activity.type, privacy.units), inline: false },
    { name: 'Time', value: formatDuration(activity.moving_time), inline: true },
    {
      name: isSpeedSport ? 'Speed' : 'Pace',
      value: formatPace(activity.average_speed, activity.type, privacy.units),
      inline: true,
    },
  ];

  if (activity.has_heartrate && typeof activity.average_heartrate === 'number') {
    fields.push({
      name: 'Avg HR',
      value: `${Math.round(activity.average_heartrate)} bpm`,
      inline: true,
    });
  }
  if (activity.achievement_count > 0 || activity.pr_count > 0) {
    const bits: string[] = [];
    if (activity.pr_count > 0) bits.push(`${activity.pr_count} PR${activity.pr_count > 1 ? 's' : ''}`);
    if (activity.achievement_count > 0)
      bits.push(`${activity.achievement_count} achievement${activity.achievement_count > 1 ? 's' : ''}`);
    fields.push({ name: 'Highlights', value: bits.join(' · '), inline: true });
  }
  main.addFields(fields);

  // In private mode we stop here. No image, no charts, no mention.
  if (isPrivate) return [main];

  const embeds: EmbedBuilder[] = [main];

  // Build chart URLs in parallel — each round-trips to QuickChart's
  // shortener (~100ms).
  const [hrUrl, paceUrl] = await Promise.all([
    privacy.showHeartRate && activity._streams
      ? buildHeartRateChartUrl(activity._streams)
      : Promise.resolve(null),
    privacy.showPaceChart && activity._streams
      ? buildPaceChartUrl(activity._streams, {
          sportType: activity.sport_type || activity.type,
          units: privacy.units,
        })
      : Promise.resolve(null),
  ]);

  // No setURL on chart embeds — keeps the message visually consistent
  // with the (link-less) main embed.
  if (paceUrl) {
    embeds.push(new EmbedBuilder().setColor(STRAVA_ORANGE).setImage(paceUrl));
  }
  if (hrUrl) {
    embeds.push(new EmbedBuilder().setColor(STRAVA_ORANGE).setImage(hrUrl));
  }

  // If the activity had a Strava photo, add it last (capped at 10
  // embeds total, which we're well under).
  const primaryUrls = activity.photos?.primary?.urls;
  if (primaryUrls && embeds.length < 10) {
    const sizes = Object.keys(primaryUrls)
      .map((k) => parseInt(k, 10))
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => b - a);
    const largest = sizes[0];
    const photoUrl = largest ? primaryUrls[String(largest)] : undefined;
    if (photoUrl) {
      embeds.push(
        new EmbedBuilder()
          .setColor(STRAVA_ORANGE)
          .setURL(url)
          .setImage(photoUrl),
      );
    }
  }

  return embeds;
}
