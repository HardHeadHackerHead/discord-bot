# Music Streaming Provider API Specification

**Version:** 1.0.0
**Last Updated:** 2026-03-19
**Status:** Draft

This document defines the API contract that an external music streaming provider must implement to integrate with our Discord bot's music module.

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Base URL & Transport](#base-url--transport)
4. [Response Format](#response-format)
5. [Error Handling](#error-handling)
6. [Rate Limits](#rate-limits)
7. [Endpoints](#endpoints)
   - [Search Tracks](#search-tracks)
   - [Get Track](#get-track)
   - [Get Stream URL](#get-stream-url)
   - [Browse Category](#browse-category) (optional)
   - [Batch Get Tracks](#batch-get-tracks) (optional)
8. [Stream URL Requirements](#stream-url-requirements)
9. [Webhooks](#webhooks) (optional)
10. [Technical Requirements](#technical-requirements)

---

## Overview

The bot requests track metadata and time-limited audio stream URLs from the provider's REST API. The bot handles all user-facing features (playlists, likes, play counts, queue management) internally. The provider is responsible only for:

- Searching its catalog
- Returning track metadata
- Issuing time-limited, DRM-free audio stream URLs

The bot will never redistribute or cache audio content.

---

## Authentication

All API requests include an API key in the `Authorization` header:

```
Authorization: Bearer <api_key>
```

API keys are issued per-integration and should be treated as secrets. The provider should support key rotation without downtime (accept both old and new keys during a transition period).

---

## Base URL & Transport

- **Base URL:** Configurable (e.g., `https://api.musicprovider.example/v1`)
- **Protocol:** HTTPS only (TLS 1.2+ required)
- **Content-Type:** `application/json` for all request and response bodies
- **Character Encoding:** UTF-8

---

## Response Format

### Success Response

```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-03-19T12:00:00Z"
  }
}
```

### Error Response

```json
{
  "success": false,
  "error": {
    "code": "TRACK_NOT_FOUND",
    "message": "The requested track does not exist or has been removed.",
    "details": {}
  },
  "meta": {
    "request_id": "req_abc123",
    "timestamp": "2026-03-19T12:00:00Z"
  }
}
```

### Standard Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Invalid or missing API key |
| `FORBIDDEN` | 403 | API key does not have permission for this operation |
| `TRACK_NOT_FOUND` | 404 | Track ID does not exist in catalog |
| `VALIDATION_ERROR` | 400 | Request parameters are invalid |
| `RATE_LIMITED` | 429 | Too many requests — respect `Retry-After` header |
| `STREAM_UNAVAILABLE` | 503 | Audio stream temporarily unavailable for this track |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## Rate Limits

Rate limits are per API key and communicated via response headers:

| Header | Description |
|--------|-------------|
| `X-RateLimit-Limit` | Maximum requests allowed in the current window |
| `X-RateLimit-Remaining` | Requests remaining in the current window |
| `X-RateLimit-Reset` | Unix timestamp (seconds) when the window resets |
| `Retry-After` | Seconds to wait before retrying (only on 429 responses) |

### Default Limits

| Endpoint | Rate Limit |
|----------|------------|
| `GET /tracks/search` | 30 requests/minute |
| `GET /tracks/{track_id}` | 60 requests/minute |
| `POST /tracks/{track_id}/stream` | 60 requests/minute |
| `GET /browse/{category}` | 10 requests/minute |
| `POST /tracks/batch` | 10 requests/minute |

---

## Endpoints

### Search Tracks

Search the catalog by text query (title, artist, album, etc.).

**Request:**

```
GET /tracks/search?q={query}&limit={limit}&offset={offset}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `q` | string | yes | — | Search query text |
| `limit` | integer | no | 10 | Max results to return (1-50) |
| `offset` | integer | no | 0 | Offset for pagination |

**Response Data:**

```json
{
  "tracks": [
    {
      "id": "trk_abc123",
      "title": "Song Title",
      "artist": "Artist Name",
      "album": "Album Name",
      "duration": 237,
      "artwork_url": "https://cdn.example.com/artwork/trk_abc123.jpg",
      "genres": ["rock", "alternative"],
      "release_date": "2024-06-15",
      "explicit": false
    }
  ],
  "total": 142,
  "limit": 10,
  "offset": 0
}
```

**Track Object Schema:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | yes | Unique, stable track identifier |
| `title` | string | yes | Track title |
| `artist` | string | yes | Primary artist name |
| `album` | string | no | Album name (null if single) |
| `duration` | integer | yes | Duration in seconds |
| `artwork_url` | string | no | URL to album/track artwork (HTTPS, JPEG/PNG, min 300x300px) |
| `genres` | string[] | no | Genre tags |
| `release_date` | string | no | ISO 8601 date (YYYY-MM-DD) |
| `explicit` | boolean | no | Whether the track has explicit content |

---

### Get Track

Get full metadata for a single track.

**Request:**

```
GET /tracks/{track_id}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `track_id` | string (path) | yes | Track identifier |

**Response Data:**

Returns a single track object (same schema as search results).

```json
{
  "id": "trk_abc123",
  "title": "Song Title",
  "artist": "Artist Name",
  "album": "Album Name",
  "duration": 237,
  "artwork_url": "https://cdn.example.com/artwork/trk_abc123.jpg",
  "genres": ["rock", "alternative"],
  "release_date": "2024-06-15",
  "explicit": false
}
```

---

### Get Stream URL

Request a time-limited, direct audio stream URL for playback.

**Request:**

```
POST /tracks/{track_id}/stream
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `track_id` | string (path) | yes | Track identifier |

**Request Body (optional):**

```json
{
  "quality": "high"
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `quality` | string | no | `"standard"` | Audio quality: `"low"` (64-96 kbps), `"standard"` (128-192 kbps), `"high"` (256-320 kbps), `"lossless"` (FLAC) |

**Response Data:**

```json
{
  "url": "https://stream.example.com/audio/trk_abc123?token=eyJ...",
  "expires_at": "2026-03-19T13:00:00Z",
  "format": "mp3",
  "quality": "standard",
  "bitrate": 192,
  "sample_rate": 44100,
  "content_type": "audio/mpeg",
  "file_size": 5672960
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | yes | Direct HTTPS URL to audio bytes |
| `expires_at` | string | yes | ISO 8601 UTC expiry timestamp (minimum 15 min, recommended 1 hour) |
| `format` | string | yes | Audio format: `"mp3"`, `"ogg"`, `"aac"`, `"flac"` |
| `quality` | string | yes | Actual quality level served |
| `bitrate` | integer | no | Bitrate in kbps |
| `sample_rate` | integer | no | Sample rate in Hz |
| `content_type` | string | yes | MIME type of the audio stream |
| `file_size` | integer | no | Approximate file size in bytes |

---

### Browse Category (Optional)

Browse tracks by category (popular, new releases, random).

**Request:**

```
GET /browse/{category}?limit={limit}&offset={offset}
```

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `category` | string (path) | yes | — | Category: `"popular"`, `"new"`, `"random"` |
| `limit` | integer | no | 20 | Max results (1-50) |
| `offset` | integer | no | 0 | Offset for pagination |

**Response Data:**

Same format as search results.

---

### Batch Get Tracks (Optional)

Retrieve metadata for multiple tracks in a single request.

**Request:**

```
POST /tracks/batch
```

**Request Body:**

```json
{
  "ids": ["trk_abc123", "trk_def456", "trk_ghi789"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `ids` | string[] | yes | Track IDs to look up (max 50) |

**Response Data:**

```json
{
  "tracks": [ ... ],
  "not_found": ["trk_unknown"]
}
```

---

## Stream URL Requirements

These requirements are **critical** for compatibility with our audio playback pipeline (FFmpeg + @discordjs/voice):

### Mandatory

1. **Direct HTTP(S) URL** — The `url` field must return raw audio bytes when fetched via HTTP GET. No HLS manifests (`.m3u8`), no DASH manifests (`.mpd`), no adaptive streaming protocols.

2. **No DRM** — Audio must be plain, unencrypted. No Widevine, FairPlay, PlayReady, or any other content protection. The bot decodes audio directly with FFmpeg.

3. **Standard Codecs** — MP3 support is **required**. OGG Vorbis, AAC, and FLAC are welcomed as additional options but not required.

4. **Correct Content-Type** — The audio URL must return the appropriate `Content-Type` header:
   - MP3: `audio/mpeg`
   - OGG: `audio/ogg`
   - AAC: `audio/aac` or `audio/mp4`
   - FLAC: `audio/flac`

5. **Time-Limited Tokens** — Stream URLs must expire. Minimum expiry: **15 minutes**. Recommended: **1 hour**. The bot will request a fresh URL each time it plays a track.

6. **No CDN Rate Limiting on Audio** — Once the bot has a valid stream URL, the audio CDN must not rate-limit the actual byte download. API endpoints may be rate-limited, but audio fetches must complete without interruption.

### Recommended

7. **HTTP Range Request Support** — Support `Range` headers (`Accept-Ranges: bytes`) on the audio URL for seeking. If not supported, the bot will buffer the full stream.

8. **Content-Length Header** — Return the total byte size so the bot can report download progress and detect truncation.

9. **Low Latency** — Time from stream URL request to first audio byte should be under 2 seconds (p95).

10. **CDN Distribution** — Serve audio from geographically distributed CDN nodes for low latency worldwide.

---

## Webhooks (Optional)

If supported, the provider can send webhook notifications for catalog changes.

### Configuration

The bot provides a webhook URL during integration setup. The provider sends POST requests to this URL.

### Webhook Payload

```json
{
  "event": "track.unavailable",
  "timestamp": "2026-03-19T12:00:00Z",
  "data": {
    "track_id": "trk_abc123",
    "reason": "rights_expired"
  }
}
```

### Webhook Events

| Event | Description |
|-------|-------------|
| `track.unavailable` | A track has been removed from the catalog or is no longer streamable |
| `catalog.updated` | New tracks have been added to the catalog |

### Webhook Security

All webhook requests must include an HMAC-SHA256 signature for verification:

```
X-Webhook-Signature: sha256=<hex_digest>
```

The signature is computed over the raw request body using a shared secret:

```
HMAC-SHA256(webhook_secret, request_body)
```

---

## Technical Requirements

| Requirement | Specification |
|-------------|---------------|
| **Protocol** | HTTPS only (TLS 1.2+) |
| **Encoding** | UTF-8 for all text |
| **Date Format** | ISO 8601 (e.g., `2026-03-19T12:00:00Z`) |
| **Track IDs** | Stable, URL-safe strings (alphanumeric + underscore/hyphen) |
| **Availability** | 99.9% uptime SLA recommended |
| **Latency (API)** | p95 < 500ms for search, < 200ms for metadata, < 300ms for stream URL |
| **Latency (Audio)** | p95 time-to-first-byte < 2s |
| **Max Response Size** | Search results capped at 50 per page |
| **Compression** | Support `Accept-Encoding: gzip` on API responses |
| **CORS** | Not required (server-to-server only) |

---

## Integration Checklist

Before going live, verify the following:

- [ ] API key authentication works for all endpoints
- [ ] Search returns relevant results for common queries
- [ ] Track metadata includes at minimum: id, title, artist, duration
- [ ] Stream URLs return raw audio bytes (not manifests)
- [ ] Stream URLs are playable by FFmpeg without additional configuration
- [ ] Stream URLs expire after the stated time
- [ ] Rate limit headers are present on all responses
- [ ] Error responses follow the documented format
- [ ] 404 is returned for nonexistent track IDs (not 500)
- [ ] Audio CDN does not rate-limit byte downloads
