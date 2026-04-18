import { Logger } from '../../../shared/utils/logger.js';

const logger = new Logger('StreamingClient');

/**
 * Track metadata returned from the streaming provider
 */
export interface StreamTrack {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  duration: number;
  artwork_url: string | null;
}

/**
 * Search result from the streaming provider
 */
export interface SearchResult {
  tracks: StreamTrack[];
  total: number;
}

/**
 * Stream URL response from the provider
 */
export interface StreamUrlResult {
  url: string;
  expires_at: string;
  format: string;
  quality: string;
}

/**
 * HTTP client for the external music streaming API.
 * Configured via MUSIC_STREAMING_API_URL and MUSIC_STREAMING_API_KEY env vars.
 */
export class StreamingClient {
  private baseUrl: string;
  private apiKey: string;

  constructor() {
    this.baseUrl = (process.env['MUSIC_STREAMING_API_URL'] || '').replace(/\/+$/, '');
    this.apiKey = process.env['MUSIC_STREAMING_API_KEY'] || '';

    if (!this.baseUrl) {
      logger.warn('MUSIC_STREAMING_API_URL not configured — streaming features will be unavailable');
    }
    if (!this.apiKey) {
      logger.warn('MUSIC_STREAMING_API_KEY not configured — streaming features will be unavailable');
    }
  }

  /**
   * Check if the streaming client is properly configured
   */
  isConfigured(): boolean {
    return Boolean(this.baseUrl && this.apiKey);
  }

  /**
   * Search for tracks by text query
   */
  async search(query: string, limit: number = 10): Promise<SearchResult> {
    const params = new URLSearchParams({
      q: query,
      limit: String(limit),
    });

    const data = await this.request<{ tracks: StreamTrack[]; total: number }>(
      'GET',
      `/tracks/search?${params.toString()}`
    );

    return {
      tracks: data.tracks || [],
      total: data.total || 0,
    };
  }

  /**
   * Get full track metadata by external ID
   */
  async getTrack(externalId: string): Promise<StreamTrack | null> {
    try {
      return await this.request<StreamTrack>('GET', `/tracks/${encodeURIComponent(externalId)}`);
    } catch (error) {
      if (error instanceof StreamingApiError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get a time-limited direct audio stream URL
   */
  async getStreamUrl(externalId: string, quality?: string): Promise<StreamUrlResult> {
    const body: Record<string, string> = {};
    if (quality) {
      body['quality'] = quality;
    }

    return this.request<StreamUrlResult>(
      'POST',
      `/tracks/${encodeURIComponent(externalId)}/stream`,
      Object.keys(body).length > 0 ? body : undefined
    );
  }

  /**
   * Batch get metadata for multiple track IDs (optional endpoint)
   */
  async batchGetTracks(externalIds: string[]): Promise<StreamTrack[]> {
    try {
      const data = await this.request<{ tracks: StreamTrack[] }>('POST', '/tracks/batch', {
        ids: externalIds.slice(0, 50),
      });
      return data.tracks || [];
    } catch {
      // Fallback: fetch individually if batch endpoint not supported
      logger.debug('Batch endpoint not available, fetching tracks individually');
      const tracks: StreamTrack[] = [];
      for (const id of externalIds) {
        const track = await this.getTrack(id);
        if (track) tracks.push(track);
      }
      return tracks;
    }
  }

  /**
   * Make an authenticated request to the streaming API
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.isConfigured()) {
      throw new StreamingApiError('Streaming API not configured', 0);
    }

    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    const options: RequestInit = { method, headers };
    if (body) {
      options.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      logger.error(`Streaming API request failed: ${method} ${path}`, error);
      throw new StreamingApiError(`Network error: ${error instanceof Error ? error.message : String(error)}`, 0);
    }

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`;
      try {
        const errorBody = await response.json() as { error?: { message?: string; code?: string } };
        if (errorBody.error?.message) {
          errorMessage = errorBody.error.message;
        }
      } catch {
        // Ignore JSON parse errors
      }

      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After');
        logger.warn(`Rate limited by streaming API. Retry after: ${retryAfter || 'unknown'}s`);
      }

      throw new StreamingApiError(errorMessage, response.status);
    }

    const json = await response.json() as { success?: boolean; data?: T };

    // Handle envelope format: { success, data, meta }
    if (json.success !== undefined) {
      return json.data as T;
    }

    // Handle direct response format
    return json as T;
  }
}

/**
 * Error from the streaming API
 */
export class StreamingApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number
  ) {
    super(message);
    this.name = 'StreamingApiError';
  }
}
