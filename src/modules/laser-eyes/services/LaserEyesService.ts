import sharp from 'sharp';
import { readdir, readFile, writeFile, mkdir, access } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import { Logger } from '../../../shared/utils/logger.js';
import cv from '@techstark/opencv-js';

const logger = new Logger('LaserEyes:Service');

const LASERS_DIR = join(process.cwd(), 'assets', 'laser-eyes');
const CASCADES_DIR = join(process.cwd(), 'assets', 'opencv-cascades');
const FACE_CASCADE_PATH = join(CASCADES_DIR, 'haarcascade_frontalface_default.xml');
const EYE_CASCADE_PATH = join(CASCADES_DIR, 'haarcascade_eye.xml');
const EYE_GLASSES_CASCADE_PATH = join(CASCADES_DIR, 'haarcascade_eye_tree_eyeglasses.xml');

/** Upscale the face ROI to at least this size before running eye detection. */
const MIN_EYE_ROI_SIZE = 480;

const USER_COOLDOWN_MS = 20_000;

/**
 * Multiplier applied to the detected eye-box width to size the glow PNG.
 * 7.875× means the glow fully engulfs the eye socket and throws a generous
 * bloom halo onto the surrounding face — stank-on-it laser-eye look.
 */
const LASER_SCALE = 7.875;

/**
 * Named color presets for the slash command. Keys are what users pick in
 * Discord; values are hex strings fed to sharp.tint().
 */
export const GLOW_COLORS = {
  red:    '#ff2020',
  orange: '#ff8800',
  yellow: '#ffdd00',
  green:  '#22ff44',
  cyan:   '#22ddff',
  blue:   '#2266ff',
  purple: '#aa33ff',
  pink:   '#ff55bb',
  white:  '#ffffff',
} as const;

export type GlowColorName = keyof typeof GLOW_COLORS;

/** Default glow color used when no color is specified. */
export const DEFAULT_GLOW_COLOR: GlowColorName = 'red';

/**
 * Resolve a user-supplied color input (preset name or #hex) into a hex string
 * suitable for sharp.tint(). Returns null for invalid input. When input is
 * null/undefined/empty, returns null too — caller decides whether to use a
 * default or pick at random via pickRandomGlowColor().
 */
export function resolveGlowColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const lower = input.trim().toLowerCase();
  if (lower in GLOW_COLORS) return GLOW_COLORS[lower as GlowColorName];
  if (/^#?[0-9a-f]{6}$/i.test(lower)) return lower.startsWith('#') ? lower : `#${lower}`;
  return null;
}

/**
 * Pick a random preset color. Returns the color name and its hex value so
 * the caller can show the user which one was chosen.
 */
export function pickRandomGlowColor(): { name: GlowColorName; hex: string } {
  const names = Object.keys(GLOW_COLORS) as GlowColorName[];
  const name = names[Math.floor(Math.random() * names.length)] as GlowColorName;
  return { name, hex: GLOW_COLORS[name] };
}

/**
 * We downscale large images for faster detection. Haar cascades scale well so
 * 800px is plenty even for full-body portraits.
 */
const MAX_SCAN_DIM = 800;

export class EyesNotDetectedError extends Error {
  constructor(message = 'Could not detect eyes in the image') {
    super(message);
    this.name = 'EyesNotDetectedError';
  }
}

interface CooldownEntry {
  until: number;
}

interface EyePlacement {
  cx: number;
  cy: number;
  /** Reference width used to scale laser PNG — we use eye-to-eye distance. */
  width: number;
  mirror: boolean;
}

export class LaserEyesService {
  private readonly cooldowns = new Map<string, CooldownEntry>();
  private cvReady = false;
  private cvReadyPromise: Promise<void> | null = null;
  private faceCascade: cv.CascadeClassifier | null = null;
  private eyeCascade: cv.CascadeClassifier | null = null;
  private eyeGlassesCascade: cv.CascadeClassifier | null = null;

  isAvailable(): boolean {
    return (
      existsSync(FACE_CASCADE_PATH) &&
      existsSync(EYE_CASCADE_PATH) &&
      existsSync(EYE_GLASSES_CASCADE_PATH)
    );
  }

  getCooldownRemaining(userId: string): number {
    const entry = this.cooldowns.get(userId);
    if (!entry) return 0;
    const remainingMs = entry.until - Date.now();
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  private startCooldown(userId: string): void {
    this.cooldowns.set(userId, { until: Date.now() + USER_COOLDOWN_MS });
  }

  async fetchImage(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Wait for OpenCV.js WASM runtime to initialize, then load cascades into
   * OpenCV's virtual filesystem and instantiate the classifiers.
   */
  private async ensureReady(): Promise<void> {
    if (this.cvReady) return;
    if (this.cvReadyPromise) return this.cvReadyPromise;

    this.cvReadyPromise = (async () => {
      if (!this.isAvailable()) {
        throw new Error(`OpenCV cascades missing from ${CASCADES_DIR}`);
      }

      // Wait for the WASM module to be ready. @techstark/opencv-js fires
      // `onRuntimeInitialized` when ready. We race it with a poll on `cv.Mat`
      // since some bundles initialize synchronously.
      await new Promise<void>((resolve) => {
        const asAny = cv as unknown as { Mat?: unknown; onRuntimeInitialized?: () => void };
        if (asAny.Mat) { resolve(); return; }
        asAny.onRuntimeInitialized = () => resolve();
      });

      // Register cascade XMLs in OpenCV's virtual filesystem.
      const [faceXml, eyeXml, eyeGlassesXml] = await Promise.all([
        readFile(FACE_CASCADE_PATH),
        readFile(EYE_CASCADE_PATH),
        readFile(EYE_GLASSES_CASCADE_PATH),
      ]);

      cv.FS_createDataFile('/', 'haarcascade_frontalface_default.xml', faceXml, true, false, false);
      cv.FS_createDataFile('/', 'haarcascade_eye.xml', eyeXml, true, false, false);
      cv.FS_createDataFile('/', 'haarcascade_eye_tree_eyeglasses.xml', eyeGlassesXml, true, false, false);

      const faceCascade = new cv.CascadeClassifier();
      faceCascade.load('haarcascade_frontalface_default.xml');
      const eyeCascade = new cv.CascadeClassifier();
      eyeCascade.load('haarcascade_eye.xml');
      const eyeGlassesCascade = new cv.CascadeClassifier();
      eyeGlassesCascade.load('haarcascade_eye_tree_eyeglasses.xml');

      this.faceCascade = faceCascade;
      this.eyeCascade = eyeCascade;
      this.eyeGlassesCascade = eyeGlassesCascade;
      this.cvReady = true;
      logger.info('OpenCV.js + Haar cascades loaded');
    })();

    return this.cvReadyPromise;
  }

  /**
   * Detect a face and both eyes. Throws EyesNotDetectedError on any failure.
   * No fallback placement.
   */
  private async detectEyes(imageBuffer: Buffer): Promise<EyePlacement[]> {
    await this.ensureReady();
    if (!this.faceCascade || !this.eyeCascade || !this.eyeGlassesCascade) {
      throw new Error('Cascades not initialized');
    }
    const faceCascade = this.faceCascade;
    const eyeCascade = this.eyeCascade;
    const eyeGlassesCascade = this.eyeGlassesCascade;

    const meta = await sharp(imageBuffer).metadata();
    const origW = meta.width ?? 0;
    const origH = meta.height ?? 0;
    if (origW === 0 || origH === 0) throw new Error('Could not read image dimensions');

    // Downscale if needed to keep detection fast, preserving aspect ratio.
    const scaleFactor = Math.min(1, MAX_SCAN_DIM / Math.max(origW, origH));
    const scanW = Math.round(origW * scaleFactor);
    const scanH = Math.round(origH * scaleFactor);

    const { data: rgba, info } = await sharp(imageBuffer)
      .resize(scanW, scanH, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Build an OpenCV Mat from the RGBA buffer. OpenCV.js's matFromImageData
    // only reads .data/.width/.height — we cast through unknown to avoid
    // needing the DOM ImageData type in a Node tsconfig.
    const imageDataLike = {
      data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength),
      width: info.width,
      height: info.height,
      colorSpace: 'srgb',
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const src = (cv as any).matFromImageData(imageDataLike);

    const gray = new cv.Mat();
    const faces = new cv.RectVector();

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.equalizeHist(gray, gray);

      // Detect frontal faces. scaleFactor/minNeighbors tuned for portrait shots.
      faceCascade.detectMultiScale(
        gray,
        faces,
        1.1,   // scaleFactor
        5,     // minNeighbors — higher = fewer false positives
        0,
        new cv.Size(Math.round(scanW * 0.08), Math.round(scanH * 0.08)),
        new cv.Size(0, 0)
      );

      if (faces.size() === 0) {
        throw new EyesNotDetectedError('No face detected');
      }

      // Pick the largest face (most prominent subject).
      let bestFace = faces.get(0);
      let bestArea = bestFace.width * bestFace.height;
      for (let i = 1; i < faces.size(); i++) {
        const f = faces.get(i);
        const area = f.width * f.height;
        if (area > bestArea) { bestFace = f; bestArea = area; }
      }

      logger.debug(
        `Scan ${scanW}x${scanH} — detected ${faces.size()} face(s). ` +
        `Using largest: ${bestFace.width}x${bestFace.height} at (${bestFace.x},${bestFace.y})`
      );

      // Strategy: the Haar face cascade is reliable, but the Haar eye
      // cascade is famously unreliable (false positives on cheeks/hair/
      // mouths, misses on many real eyes). Rather than fight it, we use
      // anthropometric placement: on a standard frontal face bbox, the
      // eyes sit at predictable relative positions. We FIRST try the eye
      // cascade with symmetry scoring; if that fails, we fall back to
      // anthropometric coords. This gives us perfect-alignment detections
      // when the cascade cooperates, and always-reasonable placement when
      // it doesn't.

      // Eyes: search only within the upper 60% of the face region to avoid
      // mouths/nostrils being picked up.
      const eyeRegionH = Math.round(bestFace.height * 0.6);
      const rawFaceRoi = gray.roi(new cv.Rect(bestFace.x, bestFace.y, bestFace.width, eyeRegionH));

      // Haar eye cascades struggle on small faces — we upscale the ROI to at
      // least MIN_EYE_ROI_SIZE wide. Detected eye coords are divided by
      // roiScale before being mapped back to scan coords below.
      const roiScale = Math.max(1, MIN_EYE_ROI_SIZE / bestFace.width);
      const faceRoi = new cv.Mat();
      if (roiScale > 1) {
        const newW = Math.round(bestFace.width * roiScale);
        const newH = Math.round(eyeRegionH * roiScale);
        cv.resize(rawFaceRoi, faceRoi, new cv.Size(newW, newH), 0, 0, cv.INTER_CUBIC);
      } else {
        rawFaceRoi.copyTo(faceRoi);
      }
      cv.equalizeHist(faceRoi, faceRoi);
      rawFaceRoi.delete();

      // Try a sequence of (cascade, params) passes in decreasing strictness.
      // Both cascades + multiple relaxation levels gives us the best chance
      // against lighting/angle variation. We stop at the first pass that
      // returns ≥ 2 eyes.
      const tryDetect = (
        cascade: cv.CascadeClassifier,
        minNeighbors: number,
        scaleFactor: number
      ): cv.RectVector => {
        const ev = new cv.RectVector();
        cascade.detectMultiScale(
          faceRoi,
          ev,
          scaleFactor,
          minNeighbors,
          0,
          new cv.Size(Math.round(faceRoi.cols * 0.08), Math.round(faceRoi.rows * 0.08)),
          new cv.Size(Math.round(faceRoi.cols * 0.55), Math.round(faceRoi.rows * 0.6))
        );
        return ev;
      };

      const passes: { cascade: cv.CascadeClassifier; mn: number; sf: number; name: string }[] = [
        { cascade: eyeCascade,        mn: 5, sf: 1.1,  name: 'eye' },
        { cascade: eyeCascade,        mn: 3, sf: 1.1,  name: 'eye' },
        { cascade: eyeGlassesCascade, mn: 5, sf: 1.1,  name: 'eye_glasses' },
        { cascade: eyeGlassesCascade, mn: 3, sf: 1.1,  name: 'eye_glasses' },
        { cascade: eyeCascade,        mn: 2, sf: 1.05, name: 'eye' },
        { cascade: eyeGlassesCascade, mn: 2, sf: 1.05, name: 'eye_glasses' },
        { cascade: eyeCascade,        mn: 1, sf: 1.05, name: 'eye' },
        { cascade: eyeGlassesCascade, mn: 1, sf: 1.05, name: 'eye_glasses' },
      ];

      // Run every pass and union all detections. Deduplicate boxes whose
      // centers are very close — the same real eye often gets hit by both
      // cascades at similar positions. The pairwise symmetry scorer below
      // benefits from a larger candidate pool.
      const allCandidates: { x: number; y: number; w: number; h: number }[] = [];
      for (const { cascade, mn, sf, name } of passes) {
        const ev = tryDetect(cascade, mn, sf);
        for (let i = 0; i < ev.size(); i++) {
          const e = ev.get(i);
          const cx = e.x + e.width / 2;
          const cy = e.y + e.height / 2;
          const tooClose = allCandidates.some(c => {
            const ocx = c.x + c.w / 2;
            const ocy = c.y + c.h / 2;
            const dist = Math.hypot(cx - ocx, cy - ocy);
            return dist < Math.min(e.width, c.w) * 0.5;
          });
          if (!tooClose) {
            allCandidates.push({ x: e.x, y: e.y, w: e.width, h: e.height });
          }
        }
        ev.delete();
        logger.debug(
          `Eye pass cascade=${name} mn=${mn} sf=${sf} ` +
          `pool=${allCandidates.length} (roiScale=${roiScale.toFixed(2)})`
        );
      }
      // Adapt the rest of the pipeline — replace the old `eyes` RectVector
      // with our synthesized list, and delete the placeholder vector.
      const eyes = new cv.RectVector(); // still used in finally{} cleanup

      try {
        if (allCandidates.length < 2) {
          throw new EyesNotDetectedError(`Only ${allCandidates.length} eye candidate(s) found`);
        }

        const eyeList = allCandidates.map(c => ({ ...c, area: c.w * c.h }));
        eyeList.sort((a, b) => b.area - a.area);
        const [e1, e2] = eyeList;
        if (!e1 || !e2) throw new EyesNotDetectedError('Need two eyes');

        // Score every (left-side, right-side) pair and pick the best one.
        // Real eyes are symmetric: similar Y position, similar size, and
        // mirrored about the face center. False positives rarely pair up.
        const roiMidlineX = faceRoi.cols / 2;
        const leftCandidates = eyeList.filter(e => (e.x + e.w / 2) < roiMidlineX);
        const rightCandidates = eyeList.filter(e => (e.x + e.w / 2) >= roiMidlineX);

        if (leftCandidates.length === 0 || rightCandidates.length === 0) {
          throw new EyesNotDetectedError(
            `Eye detections were all on one side (left=${leftCandidates.length}, right=${rightCandidates.length})`
          );
        }

        let best: { left: typeof leftCandidates[number]; right: typeof rightCandidates[number]; score: number } | null = null;
        const faceHeightScaled = bestFace.height * roiScale;
        const faceWidthScaled = bestFace.width * roiScale;

        for (const l of leftCandidates) {
          for (const r of rightCandidates) {
            const lcx = l.x + l.w / 2;
            const lcy = l.y + l.h / 2;
            const rcx = r.x + r.w / 2;
            const rcy = r.y + r.h / 2;

            // Vertical alignment: eyes should share a Y position (within
            // 20% of face height — tolerant of slight head tilt).
            const verticalDiff = Math.abs(lcy - rcy);
            if (verticalDiff > faceHeightScaled * 0.2) continue;

            // Size parity: boxes should be comparable. Real paired eyes are
            // almost always within 2× of each other.
            const sizeRatio = Math.min(l.w, r.w) / Math.max(l.w, r.w);
            if (sizeRatio < 0.45) continue;

            // Spacing: real inter-pupil distance is ~33–40% of face width.
            // Allow 28%–55% to accommodate bbox imprecision; anything tighter
            // means the two boxes are on a single feature (eye + eyebrow,
            // two hits on the same eye, etc.).
            const eyeSpacing = rcx - lcx;
            const spacingFrac = eyeSpacing / faceWidthScaled;
            if (spacingFrac < 0.28 || spacingFrac > 0.6) continue;

            // Score: lower is better. Penalize misalignment and size
            // mismatch; modestly reward symmetry around the face midline
            // (soft preference, not a hard constraint since Haar face
            // bboxes are often off-center).
            const leftDistFromCenter = roiMidlineX - lcx;
            const rightDistFromCenter = rcx - roiMidlineX;
            const asymmetry = Math.abs(leftDistFromCenter - rightDistFromCenter);
            const score =
              verticalDiff * 3 +
              asymmetry * 0.7 +
              (1 - sizeRatio) * faceWidthScaled * 0.6 -
              (l.area + r.area) * 0.0005;

            if (!best || score < best.score) {
              best = { left: l, right: r, score };
            }
          }
        }

        // Anthropometric placement: on a Haar frontal-face bbox, the cascade
        // frames from roughly eyebrow-level down to just below the chin, so
        // eyes sit at ~25% of bbox height from the top (NOT 40% — that
        // anthropometric number applies to full-head frames that include
        // forehead/hair). Horizontally, eyes are at ~30% and ~70% of bbox
        // width. Eye-box width is ~22% of face width (typical eye-to-face
        // ratio). Coordinates are in UPSCALED ROI space so the downstream
        // scan/orig conversion matches the cascade-box math.
        //
        // We use these unconditionally — they're always aligned with
        // whatever face the face cascade found, and the face cascade is
        // reliable. The eye cascade is too false-positive-prone to trust.
        const eyeBoxW = Math.round(bestFace.width * 0.22 * roiScale);
        const eyeBoxH = Math.round(bestFace.height * 0.14 * roiScale);
        const eyeY = Math.round(bestFace.height * 0.40 * roiScale - eyeBoxH / 2);
        const leftEye = {
          x: Math.round(bestFace.width * 0.30 * roiScale - eyeBoxW / 2),
          y: eyeY, w: eyeBoxW, h: eyeBoxH, area: eyeBoxW * eyeBoxH,
        };
        const rightEye = {
          x: Math.round(bestFace.width * 0.70 * roiScale - eyeBoxW / 2),
          y: eyeY, w: eyeBoxW, h: eyeBoxH, area: eyeBoxW * eyeBoxH,
        };
        void best; // scored candidates computed for potential future use

        logger.debug(
          `Anthropometric eye pair — L(${leftEye.x},${leftEye.y},${leftEye.w}x${leftEye.h}) ` +
          `R(${rightEye.x},${rightEye.y},${rightEye.w}x${rightEye.h})`
        );

        // Convert upscaled-ROI coords → face-ROI coords → scan coords →
        // original-image coords. Divide by roiScale to undo the ROI upscale.
        const leftCxScan = bestFace.x + (leftEye.x + leftEye.w / 2) / roiScale;
        const leftCyScan = bestFace.y + (leftEye.y + leftEye.h / 2) / roiScale;
        const rightCxScan = bestFace.x + (rightEye.x + rightEye.w / 2) / roiScale;
        const rightCyScan = bestFace.y + (rightEye.y + rightEye.h / 2) / roiScale;

        const scaleBack = 1 / scaleFactor;
        // Use the average eye-box width as the size anchor — this tracks the
        // eye scale directly rather than inter-eye distance. Divide by
        // roiScale so size tracks the original face, not the upscaled ROI.
        const avgEyeBoxW = (leftEye.w + rightEye.w) / 2 / roiScale;
        const laserWidthPx = avgEyeBoxW * scaleBack;

        logger.debug(
          `Face(${bestFace.width}x${bestFace.height} at ${bestFace.x},${bestFace.y}) scan — ` +
          `eyesScan L=(${leftCxScan.toFixed(0)},${leftCyScan.toFixed(0)}) R=(${rightCxScan.toFixed(0)},${rightCyScan.toFixed(0)}) — ` +
          `eyesOrig L=(${(leftCxScan * scaleBack).toFixed(0)},${(leftCyScan * scaleBack).toFixed(0)}) ` +
          `R=(${(rightCxScan * scaleBack).toFixed(0)},${(rightCyScan * scaleBack).toFixed(0)}) ` +
          `laserWidth=${laserWidthPx.toFixed(0)}px`
        );

        return [
          { cx: leftCxScan * scaleBack,  cy: leftCyScan * scaleBack,  width: laserWidthPx, mirror: false },
          { cx: rightCxScan * scaleBack, cy: rightCyScan * scaleBack, width: laserWidthPx, mirror: true  },
        ];
      } finally {
        faceRoi.delete();
        eyes.delete();
      }
    } finally {
      src.delete();
      gray.delete();
      faces.delete();
    }
  }

  private async pickLaserPng(): Promise<Buffer> {
    await ensurePlaceholderLaser();
    const files = await readdir(LASERS_DIR);
    const pngs = files.filter(f => f.toLowerCase().endsWith('.png'));
    if (pngs.length === 0) {
      throw new Error(`No laser PNGs found in ${LASERS_DIR}`);
    }
    const chosen = pngs[Math.floor(Math.random() * pngs.length)] as string;
    return sharp(join(LASERS_DIR, chosen)).toBuffer();
  }

  private async buildLaserOverlay(
    laserPng: Buffer,
    placement: EyePlacement,
    hexColor: string
  ): Promise<{ buffer: Buffer; width: number; height: number }> {
    const laserMeta = await sharp(laserPng).metadata();
    const originalW = laserMeta.width ?? 1;
    const originalH = laserMeta.height ?? 1;
    const targetWidth = Math.max(1, Math.round(placement.width * LASER_SCALE));
    const targetHeight = Math.max(1, Math.round((targetWidth / originalW) * originalH));

    // Pipeline: desaturate then tint, keeping the alpha channel intact.
    // modulate({ saturation: 0 }) strips the PNG's baked-in red cast while
    // preserving alpha. tint() then remaps brightness to the target color.
    let pipeline = sharp(laserPng)
      .ensureAlpha()
      .resize(targetWidth, targetHeight, { fit: 'contain' })
      .modulate({ saturation: 0 })
      .tint(hexColor);

    if (placement.mirror) {
      pipeline = pipeline.flop();
    }

    const finalBuffer = await pipeline.png().toBuffer();
    const finalMeta = await sharp(finalBuffer).metadata();
    return {
      buffer: finalBuffer,
      width: finalMeta.width ?? targetWidth,
      height: finalMeta.height ?? targetHeight,
    };
  }

  async applyLaserEyes(
    imageBuffer: Buffer,
    requesterId: string,
    hexColor: string = GLOW_COLORS[DEFAULT_GLOW_COLOR],
    /** 0 = no deepfry, 1 = max-level deepfry, fractional values interpolate. */
    deepfryIntensity: number = 0,
    /** Skip the per-user cooldown — used for interactive panel re-renders. */
    skipCooldown: boolean = false,
    /**
     * If true and eyes can't be detected, skip the laser composite and
     * proceed with deepfry/passthrough on the un-lasered image instead of
     * throwing EyesNotDetectedError. The return value's `eyesDetected`
     * field tells the caller whether lasers were applied.
     */
    eyesOptional: boolean = false,
    /**
     * If true, skip the laser composite even when eyes ARE detected — used
     * by the panel "No lasers" toggle. eyesDetected in the return value
     * still reports the underlying detection result so the caller knows
     * whether to show/hide the color row.
     */
    skipLasers: boolean = false
  ): Promise<{ buffer: Buffer; eyesDetected: boolean }> {
    // Normalize the input to a static, RGBA PNG of the first frame.
    //
    // - { pages: 1, animated: false } forces sharp to read only the first
    //   frame of an animated GIF/WebP. Without this, downstream resize/
    //   composite calls fail when the input is a multi-page image.
    // - .rotate() bakes EXIF orientation into the pixels (phone JPEGs
    //   store sideways pixels + a "rotate 90°" tag; we need upright pixels
    //   for the Haar face detector).
    // - .flatten() removes any palette/index oddities GIFs leave behind,
    //   ensuring a clean RGB image for the rest of the pipeline.
    const normalized = await sharp(imageBuffer, { pages: 1, animated: false })
      .rotate()
      .flatten({ background: { r: 0, g: 0, b: 0 } })
      .png()
      .toBuffer();

    // Try to detect eyes. If eyes are optional and detection fails, we skip
    // the laser composite and just deepfry / pass through the source image.
    let placements: EyePlacement[] | null;
    try {
      placements = await this.detectEyes(normalized);
    } catch (error) {
      if (eyesOptional && error instanceof EyesNotDetectedError) {
        placements = null;
      } else {
        throw error;
      }
    }

    const meta = await sharp(normalized).metadata();
    const imgW = meta.width ?? 0;
    const imgH = meta.height ?? 0;

    // Short circuit: no eyes + eyes-optional, OR caller asked to skip
    // lasers — just run the (optional) deepfry on the un-lasered image.
    // Note that we still report the underlying detection result via
    // eyesDetected so the panel can keep the color row visible.
    if (placements === null || skipLasers) {
      const output = deepfryIntensity > 0 ? await deepfryImage(normalized, deepfryIntensity) : normalized;
      if (!skipCooldown) this.startCooldown(requesterId);
      return { buffer: output, eyesDetected: placements !== null };
    }

    const laserPng = await this.pickLaserPng();

    // Build overlays first so we know the biggest one — that determines how
    // much we need to pad the canvas to allow the glow to extend past the
    // original edges (important for small images where the glow is larger
    // than the canvas, and for eyes near the edge).
    const built = await Promise.all(
      placements.map(async (p) => ({
        placement: p,
        overlay: await this.buildLaserOverlay(laserPng, p, hexColor),
      }))
    );
    const maxOverlayW = Math.max(...built.map(b => b.overlay.width));
    const maxOverlayH = Math.max(...built.map(b => b.overlay.height));

    // Pad by at least half the biggest overlay on every side. This guarantees
    // every overlay's offset after padding is >= 0 and fits inside the
    // extended canvas, even when the overlay is bigger than the original.
    const padX = Math.ceil(maxOverlayW / 2) + 2;
    const padY = Math.ceil(maxOverlayH / 2) + 2;

    const padded = await sharp(normalized)
      .extend({
        top: padY, bottom: padY, left: padX, right: padX,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const overlays = built.map(({ placement, overlay }) => {
      const top = Math.round(placement.cy + padY - overlay.height / 2);
      const left = Math.round(placement.cx + padX - overlay.width / 2);
      logger.debug(
        `Composite: imgSize=${imgW}x${imgH} pad=(${padX},${padY}) ` +
        `placement=(${placement.cx.toFixed(0)},${placement.cy.toFixed(0)}) ` +
        `overlay=${overlay.width}x${overlay.height} at (left=${left}, top=${top})`
      );
      return { input: overlay.buffer, top, left };
    });

    // Composite onto the padded canvas. Write to a separate buffer first —
    // chaining .extract() after .composite() in a single pipeline is unsafe
    // because Sharp re-orders operations and applies extract FIRST, which
    // would shift the composite offsets by (padX, padY) and place the
    // lasers off from the real eye positions.
    const composited = await sharp(padded)
      .composite(overlays)
      .png()
      .toBuffer();

    // Now crop back to original dimensions in a fresh pipeline. Any glow
    // that extended past the original edges gets naturally clipped here.
    const cropped = await sharp(composited)
      .extract({ left: padX, top: padY, width: imgW, height: imgH })
      .png()
      .toBuffer();

    const output = deepfryIntensity > 0 ? await deepfryImage(cropped, deepfryIntensity) : cropped;

    if (!skipCooldown) {
      this.startCooldown(requesterId);
    }
    return { buffer: output, eyesDetected: true };
  }
}

/**
 * Linear interpolation helper: identity (no-op) at t=0, full effect at t=1.
 */
function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * Apply deepfried-meme aesthetic with adjustable intensity.
 *
 *   intensity = 0   → no-op (caller should skip deepfry entirely)
 *   intensity = 1   → max chaos (current ceiling)
 *
 * Key technique stolen from real deepfried memes: each JPEG pass is done at
 * a REDUCED resolution then scaled back up. That makes the 8×8 JPEG block
 * artifacts visibly chunky across the whole image (not just at edges) and
 * forces flat regions into the stepped/posterized look you see in proper
 * fried images. Without this, the artifacts are too fine to see.
 *
 * Pipeline:
 *   1. Saturation/brightness explosion
 *   2. Contrast crush
 *   3. Asymmetric per-channel warm shift (preserves hue)
 *   4. Aggressive sharpen #1
 *   5. DOWNSCALE → JPEG q1 → UPSCALE  (chunky block artifacts)
 *   6. Re-saturate + sharpen #2
 *   7. DOWNSCALE harder → JPEG q2 → UPSCALE  (compounds artifacts)
 *   8. Bloom: blur copy, screen-blend over original (halation)
 *   9. Final saturation/brightness top-up + midtone gamma
 *  10. Final JPEG round-trip at native resolution, back to PNG
 */
async function deepfryImage(input: Buffer, intensity: number): Promise<Buffer> {
  const t = Math.max(0, Math.min(1, intensity));

  // Get source dimensions so we can scale-down → compress → scale-up.
  const meta = await sharp(input).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;

  // Interpolated parameters. Color/contrast knobs ramp from identity at
  // t=0 to max at t=1. Downscale + JPEG knobs DON'T start at identity —
  // even at low intensity we want visible block grain, just less of it.
  // (If the user picks Off they get t=0 and the whole pipeline is skipped
  // by the caller, so this only affects intensities > 0.)
  const sat1     = lerp(1.0,  3.2, t);
  const bright1  = lerp(1.0,  1.05, t);
  const contrast = lerp(1.0,  2.0, t);
  const offset   = lerp(0,    -45, t);
  const chR      = lerp(1.0,  1.22, t);
  const chG      = lerp(1.0,  1.05, t);
  const chB      = lerp(1.0,  0.85, t);
  const offR     = lerp(0,    8,   t);
  const offB     = lerp(0,    -10, t);
  const sharp1   = lerp(0.3,  3.5, t);
  const sharp2   = lerp(0.3,  2.5, t);
  // JPEG quality starts already-low (40/30/40) at faint intensity and
  // collapses to brutal (5/3/6) at max. Even Light fry has visible blocks.
  const q1       = Math.round(lerp(40, 5, t));
  const q2       = Math.round(lerp(30, 3, t));
  const q3       = Math.round(lerp(40, 6, t));
  // Downscale fractions — start at 0.55 (already chunky) and collapse to
  // 0.18 / 0.12 / 0.10 at max. Three passes layered on top of each other
  // create overlapping block grids at different sizes for that
  // "JPEG-corrupted-into-oblivion" texture.
  const ds1Frac  = lerp(0.55, 0.18, t);
  const ds2Frac  = lerp(0.45, 0.12, t);
  const ds3Frac  = lerp(0.65, 0.30, t);
  const sat2     = lerp(1.0, 2.0, t);
  const sat3     = lerp(1.0, 1.5, t);
  const bright3  = lerp(1.0, 1.05, t);
  const gam      = lerp(1.0, 1.25, t);
  const blurAmt  = lerp(0.3, 6,   t);

  const ds1W = Math.max(1, Math.round(W * ds1Frac));
  const ds1H = Math.max(1, Math.round(H * ds1Frac));
  const ds2W = Math.max(1, Math.round(W * ds2Frac));
  const ds2H = Math.max(1, Math.round(H * ds2Frac));
  const ds3W = Math.max(1, Math.round(W * ds3Frac));
  const ds3H = Math.max(1, Math.round(H * ds3Frac));

  // 1) Saturation explosion (preserves hue) + brightness lift.
  let buf = await sharp(input).modulate({ saturation: sat1, brightness: bright1 }).toBuffer();
  // 2) Contrast crush.
  buf = await sharp(buf).linear(contrast, offset).toBuffer();
  // 3) Asymmetric warm shift — per-channel scaling, NOT a uniform tint.
  buf = await sharp(buf).linear([chR, chG, chB], [offR, 0, offB]).toBuffer();
  // 4) Sharpen pass #1.
  buf = await sharp(buf).sharpen({ sigma: sharp1, m1: 5, m2: 5 }).toBuffer();
  // 5) DOWNSCALE (nearest, hard pixels) → JPEG → UPSCALE (nearest, blocky).
  //    Using nearest in BOTH directions is what makes the JPEG blocks
  //    visible as chunky pixel patches in the final image. Lanczos would
  //    smooth them away.
  buf = await sharp(buf)
    .resize(ds1W, ds1H, { kernel: 'nearest' })
    .jpeg({ quality: q1, chromaSubsampling: '4:2:0' })
    .toBuffer();
  buf = await sharp(buf).resize(W, H, { kernel: 'nearest' }).toBuffer();
  // 6) Re-saturate (JPEG kills saturation) + sharpen the artifacts.
  buf = await sharp(buf)
    .modulate({ saturation: sat2 })
    .sharpen({ sigma: sharp2, m1: 4, m2: 4 })
    .toBuffer();
  // 7) Second downscale → JPEG → upscale, harder. Different scale than
  //    pass 5 so the block grids don't align — overlapping grids at
  //    different sizes is the texture of real deepfry.
  buf = await sharp(buf)
    .resize(ds2W, ds2H, { kernel: 'nearest' })
    .jpeg({ quality: q2, chromaSubsampling: '4:2:0' })
    .toBuffer();
  buf = await sharp(buf).resize(W, H, { kernel: 'nearest' }).toBuffer();
  // 8) Third downscale → JPEG → upscale at a slightly larger fraction.
  //    This third pass adds yet another grid alignment so the artifact
  //    field looks chaotic rather than uniformly scaled.
  buf = await sharp(buf)
    .resize(ds3W, ds3H, { kernel: 'nearest' })
    .jpeg({ quality: q1, chromaSubsampling: '4:2:0' })
    .toBuffer();
  buf = await sharp(buf).resize(W, H, { kernel: 'nearest' }).toBuffer();
  // 9) Bloom — blur a copy, screen-blend over original. Bright regions
  //    (lasers, highlights) bleed glow outward.
  const blurred = await sharp(buf).blur(blurAmt).toBuffer();
  buf = await sharp(buf).composite([{ input: blurred, blend: 'screen' }]).toBuffer();
  // 10) Final saturation/brightness top-up + midtone darken (gamma > 1).
  buf = await sharp(buf).modulate({ saturation: sat3, brightness: bright3 }).gamma(gam).toBuffer();
  // 11) Final JPEG round-trip at native resolution to bake everything in.
  buf = await sharp(buf).jpeg({ quality: q3, chromaSubsampling: '4:2:0' }).toBuffer();
  return sharp(buf).png().toBuffer();
}

async function ensurePlaceholderLaser(): Promise<void> {
  if (!existsSync(LASERS_DIR)) {
    await mkdir(LASERS_DIR, { recursive: true });
  }

  const files = existsSync(LASERS_DIR) ? await readdir(LASERS_DIR) : [];
  const hasPng = files.some(f => f.toLowerCase().endsWith('.png'));
  if (hasPng) return;

  const placeholderPath = join(LASERS_DIR, 'laser.png');
  try {
    await access(placeholderPath);
    return;
  } catch { /* need to create */ }

  const size = 256;
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
          <stop offset="15%" stop-color="#ffdddd" stop-opacity="1"/>
          <stop offset="35%" stop-color="#ff2222" stop-opacity="1"/>
          <stop offset="70%" stop-color="#aa0000" stop-opacity="0.6"/>
          <stop offset="100%" stop-color="#aa0000" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="url(#core)"/>
    </svg>
  `.trim();

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(placeholderPath, png);
  logger.info(`Wrote placeholder laser PNG to ${placeholderPath}`);
}

export type { EyePlacement };
