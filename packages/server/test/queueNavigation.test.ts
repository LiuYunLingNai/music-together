import assert from 'node:assert/strict'
import test from 'node:test'
import type { Track } from '@music-together/shared'
import { shouldRemovePlayedTrackAfterAdvance } from '../src/services/queueNavigation.js'

const track = (id: string): Track => ({
  id,
  title: id,
  artist: ['artist'],
  album: '',
  duration: 180,
  cover: '',
  source: 'netease',
  sourceId: id,
  urlId: id,
})

test('removes the previous queue item only after a successful transition to a different track', () => {
  assert.equal(shouldRemovePlayedTrackAfterAdvance(true, track('previous'), track('next')), true)
  assert.equal(shouldRemovePlayedTrackAfterAdvance(false, track('previous'), track('next')), false)
  assert.equal(shouldRemovePlayedTrackAfterAdvance(true, track('same'), track('same')), false)
  assert.equal(shouldRemovePlayedTrackAfterAdvance(true, null, track('next')), false)
  assert.equal(shouldRemovePlayedTrackAfterAdvance(true, track('previous'), null), false)
})
