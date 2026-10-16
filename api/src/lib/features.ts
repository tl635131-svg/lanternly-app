/**
 * Feature flags (env, read at request time). FEATURE_OWN_SONG (default on) gates the own_song add-on:
 * when off, the catalogue omits it and every own-song path (checkout line, music upload, music-rights,
 * brief `own_song`, a custom song in the editor) returns 403 FEATURE_DISABLED. Library tracks still work.
 */
import { features } from '../config.js';
import { OWN_SONG_ADDON } from './addons.js';
import { AppError } from './errors.js';

export const ownSongEnabled = () => features.ownSong;

export function assertOwnSongEnabled() {
  if (!features.ownSong) {
    throw new AppError(403, 'FEATURE_DISABLED', 'Using your own song is not available right now. You can still pick a track from our library.', undefined, { feature: OWN_SONG_ADDON });
  }
}

/** Add-on codes switched off by a feature flag (hidden from the catalogue, refused at checkout). */
export const disabledAddonCodes = (): string[] => (features.ownSong ? [] : [OWN_SONG_ADDON]);

/** 403 when any of these add-on codes is switched off. */
export function assertAddonsEnabled(codes: Iterable<string>) {
  for (const c of codes) if (c === OWN_SONG_ADDON) assertOwnSongEnabled();
}
