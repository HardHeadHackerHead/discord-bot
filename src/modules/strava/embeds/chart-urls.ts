/**
 * QuickChart URL builders for embeds. Currently only HR-over-distance
 * is rendered; route shape and elevation profile were removed when
 * the embed shape simplified. Re-add a builder here if either comes
 * back.
 *
 * Free, no API key, no signup. Uses QuickChart's `/chart/create`
 * shortener so the resulting image URL is short enough for Discord's
 * embed limits regardless of chart complexity.
 */

const STRAVA_ORANGE = '#FC5200';

/**
 * Upload a chart config to QuickChart and get back a short (~50 char)
 * permanent URL.
 *
 * Discord embed image URLs are capped at ~2048 chars — passing long
 * stream arrays as query string blows past that and triggers
 * `DiscordAPIError[50035] Invalid Form Body`. The shortener keeps the
 * URL trivially small regardless of chart complexity.
 *
 * Returns null on any failure — callers omit the embed rather than
 * fail the whole post.
 */
async function quickChartShortened(
  config: object,
  width: number,
  height: number,
): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch('https://quickchart.io/chart/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chart: config,
        width,
        height,
        backgroundColor: 'transparent',
        version: '4',
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      url?: string;
    };
    return json.success && typeof json.url === 'string' ? json.url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface StreamSample {
  distanceM: number[];
  heartrateBpm?: number[] | null;
  velocityMps?: number[] | null;
}

const PACED_SPORTS = ['Run', 'TrailRun', 'VirtualRun', 'Walk', 'Hike'];

/**
 * Heart-rate over distance. Returns null if there's no usable data.
 */
export async function buildHeartRateChartUrl(
  streams: StreamSample,
): Promise<string | null> {
  if (!streams.heartrateBpm || streams.heartrateBpm.length === 0) return null;
  if (!streams.distanceM || streams.distanceM.length === 0) return null;

  const labels = streams.distanceM.map((m) => (m / 1000).toFixed(2));
  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Heart Rate',
          data: streams.heartrateBpm,
          borderColor: STRAVA_ORANGE,
          backgroundColor: 'rgba(252, 82, 0, 0.15)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.2,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: { display: true, text: 'Heart Rate', color: '#fff', font: { size: 14 } },
      },
      scales: {
        x: {
          title: { display: true, text: 'Distance (km)', color: '#aaa' },
          ticks: { color: '#aaa', maxTicksLimit: 6 },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          title: { display: true, text: 'bpm', color: '#aaa' },
          ticks: { color: '#aaa' },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
      },
      animation: false,
    },
  };

  return quickChartShortened(config, 640, 300);
}

/**
 * Pace (run/walk/hike) or speed (ride/other) over distance.
 *
 * Pace is min per km/mi with a reversed y-axis (faster = higher on the
 * chart, matching running-app convention) and mm:ss tick labels.
 * Speed is km/h or mph on a normal axis. Stopped samples (v < 0.5 m/s)
 * become gaps in the pace line rather than spikes to infinity.
 *
 * Units: 'imperial' → mi; 'metric'/'both' → km.
 */
export async function buildPaceChartUrl(
  streams: StreamSample,
  opts: { sportType: string; units: string },
): Promise<string | null> {
  if (!streams.velocityMps || streams.velocityMps.length === 0) return null;
  if (!streams.distanceM || streams.distanceM.length === 0) return null;

  const imperial = opts.units === 'imperial';
  const isPaced = PACED_SPORTS.includes(opts.sportType);

  const labels = streams.distanceM.map((m) =>
    (imperial ? m / 1609.344 : m / 1000).toFixed(2),
  );

  let data: Array<number | null>;
  let yTitle: string;
  let reverse = false;
  // mm:ss tick formatter for pace axes (QuickChart evaluates function
  // strings server-side).
  let yTickCallback: string | undefined;

  if (isPaced) {
    // Minutes per km / mi. Null out near-stops so they read as gaps.
    const factor = imperial ? 1609.344 / 60 : 1000 / 60;
    data = streams.velocityMps.map((v) => (v && v > 0.5 ? factor / v : null));
    yTitle = imperial ? 'min/mi' : 'min/km';
    reverse = true;
    yTickCallback =
      'function(value){var m=Math.floor(value);var s=Math.round((value-m)*60);if(s===60){m++;s=0;}return m+":"+(s<10?"0":"")+s;}';
  } else {
    const factor = imperial ? 2.23694 : 3.6;
    data = streams.velocityMps.map((v) => (typeof v === 'number' && v >= 0 ? v * factor : null));
    yTitle = imperial ? 'mph' : 'km/h';
  }

  const yTicks: Record<string, unknown> = { color: '#aaa' };
  if (yTickCallback) yTicks['callback'] = yTickCallback;

  const config = {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: isPaced ? 'Pace' : 'Speed',
          data,
          borderColor: STRAVA_ORANGE,
          backgroundColor: 'rgba(252, 82, 0, 0.15)',
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.2,
          spanGaps: false,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: isPaced ? 'Pace' : 'Speed',
          color: '#fff',
          font: { size: 14 },
        },
      },
      scales: {
        x: {
          title: {
            display: true,
            text: imperial ? 'Distance (mi)' : 'Distance (km)',
            color: '#aaa',
          },
          ticks: { color: '#aaa', maxTicksLimit: 6 },
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
        y: {
          reverse,
          title: { display: true, text: yTitle, color: '#aaa' },
          ticks: yTicks,
          grid: { color: 'rgba(255,255,255,0.06)' },
        },
      },
      animation: false,
    },
  };

  return quickChartShortened(config, 640, 300);
}
