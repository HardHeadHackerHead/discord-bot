/**
 * Core Voice Recording Utility
 *
 * This is an EXPERIMENTAL feature. If it doesn't work properly,
 * you can safely delete this entire file and the voice/ folder.
 *
 * Dependencies required:
 * - @discordjs/voice (already installed)
 * - prism-media (may need to install: npm install prism-media)
 *
 * Usage:
 *   const recorder = new VoiceRecorder();
 *   await recorder.joinChannel(voiceChannel);
 *   recorder.startRecording(outputPath);
 *   // ... later ...
 *   await recorder.stopRecording();
 *   recorder.disconnect();
 */

import {
  joinVoiceChannel,
  VoiceConnection,
  VoiceConnectionStatus,
  entersState,
  EndBehaviorType,
  VoiceReceiver,
  createAudioPlayer,
  createAudioResource,
  AudioPlayer,
  AudioPlayerStatus,
  StreamType,
  NoSubscriberBehavior,
} from '@discordjs/voice';
import { VoiceChannel, StageChannel, GuildMember } from 'discord.js';
import { createWriteStream, WriteStream, mkdirSync, existsSync, unlinkSync, readdirSync, createReadStream } from 'fs';
import { pipeline, Transform, Readable } from 'stream';
import { spawn } from 'child_process';
import { Logger } from '../../shared/utils/logger.js';
import path from 'path';

const logger = new Logger('VoiceRecorder');

// Try to import prism-media for opus decoding
let prism: typeof import('prism-media') | null = null;
let opusAvailable = false;

try {
  prism = await import('prism-media');
  // Test if Opus decoder actually works (requires opusscript, @discordjs/opus, or node-opus)
  try {
    const testDecoder = new prism.opus.Decoder({ rate: 48000, channels: 2, frameSize: 960 });
    testDecoder.destroy();
    opusAvailable = true;
    logger.debug('prism-media with Opus support loaded successfully');
  } catch (opusErr) {
    logger.warn('prism-media loaded but Opus decoder not available.');
    logger.warn('Install an Opus library: npm install opusscript');
  }
} catch {
  logger.warn('prism-media not installed. Run: npm install prism-media');
}

export interface RecordingOptions {
  /** Output directory for recordings */
  outputDir: string;
  /** Whether to record each user separately */
  separateUsers?: boolean;
  /** Output format - 'pcm' for raw audio, 'mp3' to auto-convert with FFmpeg */
  format?: 'pcm' | 'mp3';
  /** Delete PCM files after converting to MP3 (only applies if format is 'mp3') */
  deleteOriginal?: boolean;
  /** Callback when an audio segment is captured from any user */
  onAudioCaptured?: (filePath: string, userId: string, durationMs: number) => void | Promise<void>;
  /** Silence duration before considering speech ended (ms) */
  silenceDuration?: number;
}

export interface ListenOptions {
  /** User ID to listen to (only this user's audio will be captured) */
  userId: string;
  /** Output directory for audio files */
  outputDir: string;
  /** Output format */
  format?: 'pcm' | 'mp3';
  /** Callback when an audio clip is captured (after user stops speaking) */
  onAudioCaptured?: (filePath: string, userId: string, durationMs: number) => void | Promise<void>;
  /** Silence duration before considering speech ended (ms) */
  silenceDuration?: number;
}

export interface ListenSession {
  userId: string;
  guildId: string;
  channelId: string;
  outputDir: string;
  options: ListenOptions;
  clipCount: number;
}

export interface UserRecording {
  userId: string;
  username: string;
  stream: WriteStream;
  filePath: string;
  startedAt: Date;
}

export interface RecordingSession {
  guildId: string;
  channelId: string;
  startedAt: Date;
  outputDir: string;
  users: Map<string, UserRecording>;
  options: RecordingOptions;
  /** MP3 files created after conversion (populated after stopRecording) */
  mp3Files?: string[];
}

export class VoiceRecorder {
  private connection: VoiceConnection | null = null;
  private receiver: VoiceReceiver | null = null;
  private session: RecordingSession | null = null;
  private listenSession: ListenSession | null = null;
  private subscriptions: Map<string, { unsubscribe: () => void }> = new Map();
  private audioPlayer: AudioPlayer | null = null;
  private isPlayingAudio: boolean = false;

  /**
   * Check if prism-media with Opus support is available
   */
  static isAvailable(): boolean {
    return prism !== null && opusAvailable;
  }

  /**
   * Join a voice channel
   */
  async joinChannel(channel: VoiceChannel | StageChannel): Promise<boolean> {
    try {
      if (!channel.guild) {
        logger.error('Channel has no guild');
        return false;
      }

      // Leave existing connection if any
      this.disconnect();

      this.connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false, // Must be false to receive audio
        selfMute: false, // Allow bot to speak
      });

      // Wait for connection to be ready
      await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);

      this.receiver = this.connection.receiver;

      // Create audio player for TTS playback
      this.audioPlayer = createAudioPlayer({
        behaviors: {
          noSubscriber: NoSubscriberBehavior.Pause,
        },
      });

      // Subscribe the connection to the audio player
      this.connection.subscribe(this.audioPlayer);

      // Track player state
      this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
        this.isPlayingAudio = false;
      });

      this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
        this.isPlayingAudio = true;
      });

      this.audioPlayer.on('error', (error) => {
        logger.error('Audio player error:', error);
        this.isPlayingAudio = false;
      });

      logger.info(`Joined voice channel: ${channel.name} in ${channel.guild.name}`);
      return true;
    } catch (error) {
      logger.error('Failed to join voice channel:', error);
      this.disconnect();
      return false;
    }
  }

  /**
   * Start recording audio
   */
  startRecording(options: RecordingOptions): boolean {
    if (!this.connection || !this.receiver) {
      logger.error('Not connected to a voice channel');
      return false;
    }

    if (!prism || !opusAvailable) {
      logger.error('prism-media with Opus support is not available');
      return false;
    }

    if (this.session) {
      logger.warn('Already recording');
      return false;
    }

    // Ensure output directory exists
    if (!existsSync(options.outputDir)) {
      mkdirSync(options.outputDir, { recursive: true });
    }

    const guildId = this.connection.joinConfig.guildId;
    const channelId = this.connection.joinConfig.channelId;

    this.session = {
      guildId,
      channelId: channelId || 'unknown',
      startedAt: new Date(),
      outputDir: options.outputDir,
      users: new Map(),
      options,
    };

    // Listen for users speaking
    this.receiver.speaking.on('start', (userId) => {
      this.handleUserSpeaking(userId);
    });

    logger.info(`Started recording session in guild ${guildId}`);
    return true;
  }

  /**
   * Handle when a user starts speaking
   */
  private handleUserSpeaking(userId: string): void {
    if (!this.session || !this.receiver || !prism || !opusAvailable) return;

    // Skip if already subscribed to this user
    if (this.subscriptions.has(userId)) return;

    const session = this.session;
    const startTime = Date.now();
    const silenceDuration = session.options.silenceDuration || 1000;

    try {
      // Create audio stream for this user
      const audioStream = this.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: silenceDuration,
        },
      });

      // Create output file for this user
      const timestamp = Date.now();
      const filename = `${userId}_${timestamp}.pcm`;
      const pcmPath = path.join(session.outputDir, filename);
      const writeStream = createWriteStream(pcmPath);

      // Decode Opus to PCM
      const opusDecoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
      });

      // Pipe: audioStream -> opusDecoder -> file
      pipeline(audioStream, opusDecoder, writeStream, async (err) => {
        const durationMs = Date.now() - startTime;

        if (err) {
          logger.error(`Pipeline error for user ${userId}:`, err);
        } else {
          logger.debug(`Finished recording segment for user ${userId} (${durationMs}ms)`);

          // Convert to MP3 if requested and call callback
          let finalPath = pcmPath;
          if (session.options.format === 'mp3') {
            const mp3Path = pcmPath.replace('.pcm', '.mp3');
            try {
              await this.convertPcmToMp3(pcmPath, mp3Path);
              // Delete the PCM file if requested
              if (session.options.deleteOriginal) {
                try {
                  unlinkSync(pcmPath);
                } catch {
                  // Ignore deletion errors
                }
              }
              finalPath = mp3Path;
            } catch (convErr) {
              logger.error('Failed to convert to MP3:', convErr);
            }
          }

          // Invoke callback if provided
          if (session.options.onAudioCaptured) {
            try {
              await session.options.onAudioCaptured(finalPath, userId, durationMs);
            } catch (callbackErr) {
              logger.error('Error in onAudioCaptured callback:', callbackErr);
            }
          }
        }

        // Clean up subscription
        this.subscriptions.delete(userId);
      });

      this.subscriptions.set(userId, {
        unsubscribe: () => {
          audioStream.destroy();
          writeStream.end();
        },
      });

      // Track user in session
      if (!session.users.has(userId)) {
        session.users.set(userId, {
          userId: userId,
          username: userId, // Will be updated if we can fetch the member
          stream: writeStream,
          filePath: pcmPath,
          startedAt: new Date(),
        });
      }

      logger.debug(`Started recording user ${userId}`);
    } catch (error) {
      logger.error(`Failed to start recording user ${userId}:`, error);
    }
  }

  /**
   * Stop recording and save files
   */
  async stopRecording(): Promise<RecordingSession | null> {
    if (!this.session) {
      logger.warn('No active recording session');
      return null;
    }

    const session = this.session;

    // Stop all subscriptions
    for (const [userId, sub] of this.subscriptions) {
      try {
        sub.unsubscribe();
        logger.debug(`Stopped recording user ${userId}`);
      } catch (error) {
        logger.error(`Error stopping subscription for ${userId}:`, error);
      }
    }
    this.subscriptions.clear();

    // Clear speaking listener
    if (this.receiver) {
      this.receiver.speaking.removeAllListeners('start');
    }

    this.session = null;

    // Convert to MP3 if requested
    if (session.options.format === 'mp3') {
      logger.info('Converting PCM files to MP3...');
      session.mp3Files = await this.convertSessionToMp3(session);
    }

    logger.info(`Stopped recording session. Files saved to: ${session.outputDir}`);
    return session;
  }

  /**
   * Start listening to a specific user for voice-to-AI conversations.
   * Each time the user speaks, the audio is captured and the callback is invoked.
   */
  startListening(options: ListenOptions): boolean {
    if (!this.connection || !this.receiver) {
      logger.error('Not connected to a voice channel');
      return false;
    }

    if (!prism || !opusAvailable) {
      logger.error('prism-media with Opus support is not available');
      return false;
    }

    if (this.listenSession) {
      logger.warn('Already listening');
      return false;
    }

    if (this.session) {
      logger.warn('Cannot listen while recording - stop recording first');
      return false;
    }

    // Ensure output directory exists
    if (!existsSync(options.outputDir)) {
      mkdirSync(options.outputDir, { recursive: true });
    }

    const guildId = this.connection.joinConfig.guildId;
    const channelId = this.connection.joinConfig.channelId;

    this.listenSession = {
      userId: options.userId,
      guildId,
      channelId: channelId || 'unknown',
      outputDir: options.outputDir,
      options,
      clipCount: 0,
    };

    // Listen for the specific user speaking
    this.receiver.speaking.on('start', (userId) => {
      if (userId === options.userId) {
        this.handleListenUserSpeaking(userId);
      }
    });

    logger.info(`Started listening to user ${options.userId} in guild ${guildId}`);
    return true;
  }

  /**
   * Handle when the listened user starts speaking
   */
  private handleListenUserSpeaking(userId: string): void {
    if (!this.listenSession || !this.receiver || !prism || !opusAvailable) return;
    if (userId !== this.listenSession.userId) return;

    // Skip if already capturing this user's audio
    if (this.subscriptions.has(userId)) return;

    const session = this.listenSession;
    const startTime = Date.now();

    try {
      // Create audio stream for this user
      const silenceDuration = session.options.silenceDuration || 1500;
      const audioStream = this.receiver.subscribe(userId, {
        end: {
          behavior: EndBehaviorType.AfterSilence,
          duration: silenceDuration,
        },
      });

      // Create output file
      session.clipCount++;
      const timestamp = Date.now();
      const filename = `${userId}_${timestamp}.pcm`;
      const pcmPath = path.join(session.outputDir, filename);
      const writeStream = createWriteStream(pcmPath);

      // Decode Opus to PCM
      const opusDecoder = new prism.opus.Decoder({
        rate: 48000,
        channels: 2,
        frameSize: 960,
      });

      // Pipe: audioStream -> opusDecoder -> file
      pipeline(audioStream, opusDecoder, writeStream, async (err) => {
        const durationMs = Date.now() - startTime;

        if (err) {
          logger.error(`Pipeline error for user ${userId}:`, err);
        } else {
          logger.debug(`Captured audio clip from user ${userId} (${durationMs}ms)`);

          // Convert to MP3 if requested
          let finalPath = pcmPath;
          if (session.options.format === 'mp3') {
            const mp3Path = pcmPath.replace('.pcm', '.mp3');
            try {
              await this.convertPcmToMp3(pcmPath, mp3Path);
              // Delete the PCM file
              try {
                unlinkSync(pcmPath);
              } catch {
                // Ignore deletion errors
              }
              finalPath = mp3Path;
            } catch (convErr) {
              logger.error('Failed to convert to MP3:', convErr);
            }
          }

          // Invoke callback if provided
          if (session.options.onAudioCaptured) {
            try {
              await session.options.onAudioCaptured(finalPath, userId, durationMs);
            } catch (callbackErr) {
              logger.error('Error in onAudioCaptured callback:', callbackErr);
            }
          }
        }

        // Clean up subscription
        this.subscriptions.delete(userId);
      });

      this.subscriptions.set(userId, {
        unsubscribe: () => {
          audioStream.destroy();
          writeStream.end();
        },
      });

      logger.debug(`Started capturing audio from user ${userId}`);
    } catch (error) {
      logger.error(`Failed to start capturing user ${userId}:`, error);
    }
  }

  /**
   * Stop listening to the user
   */
  stopListening(): ListenSession | null {
    if (!this.listenSession) {
      logger.warn('No active listen session');
      return null;
    }

    const session = this.listenSession;

    // Stop any active subscription
    const sub = this.subscriptions.get(session.userId);
    if (sub) {
      try {
        sub.unsubscribe();
      } catch (error) {
        logger.error('Error stopping subscription:', error);
      }
      this.subscriptions.delete(session.userId);
    }

    // Clear speaking listener
    if (this.receiver) {
      this.receiver.speaking.removeAllListeners('start');
    }

    this.listenSession = null;

    logger.info(`Stopped listening to user ${session.userId}. Clips captured: ${session.clipCount}`);
    return session;
  }

  /**
   * Check if currently listening to a user
   */
  isListening(): boolean {
    return this.listenSession !== null;
  }

  /**
   * Get the current listen session
   */
  getListenSession(): ListenSession | null {
    return this.listenSession;
  }

  /**
   * Play audio from a file in the voice channel
   * @param filePath Path to the audio file (mp3, wav, ogg, etc.)
   * @returns Promise that resolves when playback finishes
   */
  async playAudioFile(filePath: string): Promise<void> {
    if (!this.connection || !this.audioPlayer) {
      throw new Error('Not connected to a voice channel');
    }

    if (!existsSync(filePath)) {
      throw new Error(`Audio file not found: ${filePath}`);
    }

    logger.debug(`Playing audio file: ${filePath}`);

    return new Promise((resolve, reject) => {
      try {
        const resource = createAudioResource(createReadStream(filePath), {
          inputType: StreamType.Arbitrary,
        });

        const onIdle = () => {
          this.audioPlayer?.removeListener(AudioPlayerStatus.Idle, onIdle);
          this.audioPlayer?.removeListener('error', onError);
          logger.debug('Audio playback finished');
          resolve();
        };

        const onError = (error: Error) => {
          this.audioPlayer?.removeListener(AudioPlayerStatus.Idle, onIdle);
          this.audioPlayer?.removeListener('error', onError);
          logger.error('Audio playback error:', error);
          reject(error);
        };

        this.audioPlayer!.on(AudioPlayerStatus.Idle, onIdle);
        this.audioPlayer!.on('error', onError);

        this.audioPlayer!.play(resource);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Play audio from a Buffer in the voice channel
   * @param audioBuffer Audio data as a Buffer
   * @param format Audio format (default: mp3)
   * @returns Promise that resolves when playback finishes
   */
  async playAudioBuffer(audioBuffer: Buffer, format: string = 'mp3'): Promise<void> {
    if (!this.connection || !this.audioPlayer) {
      throw new Error('Not connected to a voice channel');
    }

    logger.debug(`Playing audio buffer: ${audioBuffer.length} bytes (${format})`);

    return new Promise((resolve, reject) => {
      try {
        const stream = Readable.from(audioBuffer);

        const resource = createAudioResource(stream, {
          inputType: StreamType.Arbitrary,
        });

        const onIdle = () => {
          this.audioPlayer?.removeListener(AudioPlayerStatus.Idle, onIdle);
          this.audioPlayer?.removeListener('error', onError);
          logger.debug('Audio buffer playback finished');
          resolve();
        };

        const onError = (error: Error) => {
          this.audioPlayer?.removeListener(AudioPlayerStatus.Idle, onIdle);
          this.audioPlayer?.removeListener('error', onError);
          logger.error('Audio buffer playback error:', error);
          reject(error);
        };

        this.audioPlayer!.on(AudioPlayerStatus.Idle, onIdle);
        this.audioPlayer!.on('error', onError);

        this.audioPlayer!.play(resource);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Check if currently playing audio
   */
  isPlaying(): boolean {
    return this.isPlayingAudio;
  }

  /**
   * Stop any currently playing audio
   */
  stopPlaying(): void {
    if (this.audioPlayer) {
      this.audioPlayer.stop();
      this.isPlayingAudio = false;
    }
  }

  /**
   * Convert all PCM files in a session to MP3
   */
  private async convertSessionToMp3(session: RecordingSession): Promise<string[]> {
    const mp3Files: string[] = [];
    const outputDir = session.outputDir;

    // Find all PCM files in the output directory
    let pcmFiles: string[] = [];
    try {
      pcmFiles = readdirSync(outputDir)
        .filter(f => f.endsWith('.pcm'))
        .map(f => path.join(outputDir, f));
    } catch (error) {
      logger.error('Failed to read output directory:', error);
      return mp3Files;
    }

    // Convert each PCM file to MP3
    for (const pcmFile of pcmFiles) {
      const mp3File = pcmFile.replace('.pcm', '.mp3');

      try {
        await this.convertPcmToMp3(pcmFile, mp3File);
        mp3Files.push(mp3File);

        // Delete original PCM file if requested
        if (session.options.deleteOriginal) {
          try {
            unlinkSync(pcmFile);
            logger.debug(`Deleted original PCM file: ${pcmFile}`);
          } catch (err) {
            logger.warn(`Failed to delete PCM file: ${pcmFile}`);
          }
        }
      } catch (error) {
        logger.error(`Failed to convert ${pcmFile} to MP3:`, error);
      }
    }

    logger.info(`Converted ${mp3Files.length} files to MP3`);
    return mp3Files;
  }

  /**
   * Convert a single PCM file to MP3 using FFmpeg
   */
  private convertPcmToMp3(pcmPath: string, mp3Path: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // FFmpeg command: convert raw PCM (48kHz, stereo, 16-bit signed little-endian) to MP3
      const ffmpeg = spawn('ffmpeg', [
        '-y',                    // Overwrite output file
        '-f', 's16le',           // Input format: signed 16-bit little-endian
        '-ar', '48000',          // Sample rate: 48kHz
        '-ac', '2',              // Channels: stereo
        '-i', pcmPath,           // Input file
        '-b:a', '128k',          // Output bitrate: 128kbps
        mp3Path                  // Output file
      ]);

      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.debug(`Converted: ${path.basename(pcmPath)} -> ${path.basename(mp3Path)}`);
          resolve();
        } else {
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
        }
      });

      ffmpeg.on('error', (error) => {
        reject(new Error(`Failed to spawn FFmpeg: ${error.message}`));
      });
    });
  }

  /**
   * Check if FFmpeg is available
   */
  static checkFfmpeg(): Promise<boolean> {
    return new Promise((resolve) => {
      const ffmpeg = spawn('ffmpeg', ['-version']);
      ffmpeg.on('close', (code) => resolve(code === 0));
      ffmpeg.on('error', () => resolve(false));
    });
  }

  /**
   * Disconnect from voice channel
   */
  disconnect(): void {
    // Stop any active recording
    if (this.session) {
      this.stopRecording();
    }

    // Stop any active listening
    if (this.listenSession) {
      this.stopListening();
    }

    // Stop audio player
    if (this.audioPlayer) {
      this.audioPlayer.stop();
      this.audioPlayer = null;
      this.isPlayingAudio = false;
    }

    if (this.connection) {
      try {
        this.connection.destroy();
        logger.info('Disconnected from voice channel');
      } catch (error) {
        logger.error('Error disconnecting:', error);
      }
      this.connection = null;
      this.receiver = null;
    }
  }

  /**
   * Check if currently connected
   */
  isConnected(): boolean {
    return this.connection !== null &&
      this.connection.state.status === VoiceConnectionStatus.Ready;
  }

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this.session !== null;
  }

  /**
   * Get current session info
   */
  getSession(): RecordingSession | null {
    return this.session;
  }
}

/**
 * Singleton instance for global access
 */
let globalRecorder: VoiceRecorder | null = null;

export function getVoiceRecorder(): VoiceRecorder {
  if (!globalRecorder) {
    globalRecorder = new VoiceRecorder();
  }
  return globalRecorder;
}

export function destroyVoiceRecorder(): void {
  if (globalRecorder) {
    globalRecorder.disconnect();
    globalRecorder = null;
  }
}
