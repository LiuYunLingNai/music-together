export const SOLO_MAX_GAP_MS = 6_000

export class SoloPlaybackClock {
  totalMs = 0
  private span?: { at: number; pos: number; lastAt: number; lastPos: number; credited: number }

  interrupt(): void {
    this.span = undefined
  }

  sample(at: number, pos: number): void {
    if (!Number.isFinite(at) || !Number.isFinite(pos) || pos < 0) return this.interrupt()
    const s = this.span
    const wall = s ? at - s.lastAt : 0
    const media = s ? pos - s.lastPos : 0
    if (s && wall >= 0 && wall <= SOLO_MAX_GAP_MS && media === 0) return
    if (!s || wall <= 0 || wall > SOLO_MAX_GAP_MS || media <= 0 || media > wall * 1.05 + 200) {
      this.span = { at, pos, lastAt: at, lastPos: pos, credited: 0 }
      return
    }
    // Clamp a continuous span once so alternating early/late packets don't accumulate rounding losses.
    const credited = Math.min(at - s.at, pos - s.pos)
    this.totalMs += credited - s.credited
    Object.assign(s, { lastAt: at, lastPos: pos, credited })
  }
}
