import { randomUUID } from 'node:crypto'
import { db } from './database.js'
import { LIMITS, type Track, type UserPlaylist, type UserPlaylistDetail } from '@music-together/shared'

interface PlaylistRow {
  id: string
  user_id: string
  name: string
  cover: string | null
  created_at: number
  updated_at: number
}

interface PlaylistTrackRow {
  track_json: string
}

/** Strip short-lived / device-specific fields before persisting a track. */
function sanitizeTrack(track: Track): Track {
  const { streamUrl: _streamUrl, requiresServerProxy: _proxy, streamFormat: _format, requestedBy: _by, ...rest } = track
  return rest
}

function parseTrack(json: string): Track | null {
  try {
    return JSON.parse(json) as Track
  } catch {
    return null
  }
}

const selectPlaylists = db.prepare<[string], PlaylistRow>(
  'SELECT * FROM user_playlists WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC',
)
const selectPlaylist = db.prepare<[string, string], PlaylistRow>(
  'SELECT * FROM user_playlists WHERE id = ? AND user_id = ?',
)
const countPlaylists = db.prepare<[string], { count: number }>(
  'SELECT COUNT(*) AS count FROM user_playlists WHERE user_id = ?',
)
const insertPlaylist = db.prepare(
  'INSERT INTO user_playlists (id, user_id, name, cover, created_at, updated_at) VALUES (@id, @userId, @name, @cover, @now, @now)',
)
const renamePlaylist = db.prepare('UPDATE user_playlists SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
const touchPlaylist = db.prepare('UPDATE user_playlists SET updated_at = ? WHERE id = ?')
const deletePlaylist = db.prepare('DELETE FROM user_playlists WHERE id = ? AND user_id = ?')

const selectTracks = db.prepare<[string], PlaylistTrackRow>(
  'SELECT track_json FROM user_playlist_tracks WHERE playlist_id = ? ORDER BY position ASC, rowid ASC',
)
const countTracks = db.prepare<[string], { count: number }>(
  'SELECT COUNT(*) AS count FROM user_playlist_tracks WHERE playlist_id = ?',
)
const maxPosition = db.prepare<[string], { value: number | null }>(
  'SELECT MAX(position) AS value FROM user_playlist_tracks WHERE playlist_id = ?',
)
const trackExists = db.prepare<[string, string], { one: number }>(
  'SELECT 1 AS one FROM user_playlist_tracks WHERE playlist_id = ? AND track_id = ?',
)
const insertTrack = db.prepare(
  'INSERT INTO user_playlist_tracks (playlist_id, track_id, track_json, position, added_at) VALUES (@playlistId, @trackId, @trackJson, @position, @now)',
)
const deleteTrack = db.prepare('DELETE FROM user_playlist_tracks WHERE playlist_id = ? AND track_id = ?')

/** Derive the playlist cover from an explicit value or the first track's artwork. */
function resolveCover(row: PlaylistRow): string | null {
  if (row.cover) return row.cover
  const first = selectTracks.all(row.id)[0]
  const track = first ? parseTrack(first.track_json) : null
  return track?.thumbnailCover ?? track?.cover ?? null
}

function toMeta(row: PlaylistRow): UserPlaylist {
  return {
    id: row.id,
    name: row.name,
    cover: resolveCover(row),
    trackCount: countTracks.get(row.id)?.count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export type CreatePlaylistResult =
  | { success: true; playlist: UserPlaylist }
  | { success: false; reason: 'limit_reached' }

export type AddTracksResult =
  | { success: true; added: number; trackCount: number }
  | { success: false; reason: 'not_found' | 'full' }

const addTracksTx = db.transaction((playlistId: string, tracks: Track[]): { added: number; trackCount: number } => {
  let position = (maxPosition.get(playlistId)?.value ?? -1) + 1
  const existing = countTracks.get(playlistId)?.count ?? 0
  let count = existing
  let added = 0
  const now = Date.now()
  for (const track of tracks) {
    if (count >= LIMITS.USER_PLAYLIST_TRACKS_MAX) break
    if (trackExists.get(playlistId, track.id)) continue
    insertTrack.run({
      playlistId,
      trackId: track.id,
      trackJson: JSON.stringify(sanitizeTrack(track)),
      position: position++,
      now,
    })
    count++
    added++
  }
  if (added > 0) touchPlaylist.run(now, playlistId)
  return { added, trackCount: count }
})

export const userPlaylistRepo = {
  list(userId: string): UserPlaylist[] {
    return selectPlaylists.all(userId).map(toMeta)
  },

  create(userId: string, name: string): CreatePlaylistResult {
    const count = countPlaylists.get(userId)?.count ?? 0
    if (count >= LIMITS.USER_PLAYLIST_MAX) return { success: false, reason: 'limit_reached' }
    const now = Date.now()
    const id = randomUUID()
    insertPlaylist.run({ id, userId, name, cover: null, now })
    return { success: true, playlist: toMeta(selectPlaylist.get(id, userId)!) }
  },

  rename(userId: string, id: string, name: string): UserPlaylist | null {
    const changes = renamePlaylist.run(name, Date.now(), id, userId).changes
    if (changes === 0) return null
    return toMeta(selectPlaylist.get(id, userId)!)
  },

  remove(userId: string, id: string): boolean {
    return deletePlaylist.run(id, userId).changes > 0
  },

  get(userId: string, id: string): UserPlaylistDetail | null {
    const row = selectPlaylist.get(id, userId)
    if (!row) return null
    const tracks = selectTracks
      .all(id)
      .map((entry) => parseTrack(entry.track_json))
      .filter((track): track is Track => track !== null)
    return { ...toMeta(row), tracks }
  },

  addTracks(userId: string, id: string, tracks: Track[]): AddTracksResult {
    const row = selectPlaylist.get(id, userId)
    if (!row) return { success: false, reason: 'not_found' }
    const current = countTracks.get(id)?.count ?? 0
    if (current >= LIMITS.USER_PLAYLIST_TRACKS_MAX) return { success: false, reason: 'full' }
    const { added, trackCount } = addTracksTx(id, tracks)
    return { success: true, added, trackCount }
  },

  removeTrack(userId: string, id: string, trackId: string): boolean {
    const row = selectPlaylist.get(id, userId)
    if (!row) return false
    const changes = deleteTrack.run(id, trackId).changes
    if (changes > 0) touchPlaylist.run(Date.now(), id)
    return changes > 0
  },
}
