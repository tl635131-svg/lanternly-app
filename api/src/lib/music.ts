import { config } from '../config.js';

/** Storage key prefix for the built-in (public) music library. Uploaded audio stays private under assets/. */
export const LIBRARY_MUSIC_PREFIX = 'library/music/';
export const LIBRARY_FILE_RE = /^[a-z0-9][a-z0-9-]{0,80}\.mp3$/;

/** Path stored in `music_tracks.url` for a library file served by this API. */
export const libraryTrackPath = (file: string) => `/api/public/music/files/${file}`;

/** API-relative track URLs (library files) become absolute. External URLs pass through unchanged. */
export function publicTrackUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith('/') ? `${config.API_PUBLIC_URL}${url}` : url;
}
