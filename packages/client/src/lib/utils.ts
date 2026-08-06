import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Track } from '@music-together/shared'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Stable UI key for a playable track. Bilibili multi-part tracks share sourceId,
 * while urlId includes the selected page CID and keeps their checked state distinct. */
export const trackKey = (t: Pick<Track, 'source' | 'sourceId' | 'urlId'>): string => `${t.source}:${t.urlId || t.sourceId}`
