export function roomIdFromLink(input: string): string | null {
  try {
    const url = new URL(input)
    if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'musictogether:') return null
    const parts = url.pathname.split('/').filter(Boolean)
    const roomIndex = parts.findIndex((part) => part.toLowerCase() === 'room')
    const candidate = roomIndex >= 0
      ? parts[roomIndex + 1]
      : url.protocol === 'musictogether:' && url.hostname.toLowerCase() === 'room'
        ? parts[0]
        : undefined
    return candidate && /^[a-zA-Z0-9_-]{1,64}$/.test(candidate) ? candidate : null
  } catch {
    return null
  }
}
