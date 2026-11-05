import type { BeatThisWgslManifest } from './beatThisWgsl/runtime'

/**
 * `beat_this-wgsl.bin` / `htdemucs-wgsl.bin` 的格式（上游 `electron/analysis/packedWeights.cjs`）：
 *
 *   [tensors: manifest.bytes][manifest JSON, UTF-8]["FOLIABTW"][uint64 LE: JSON 的起始偏移]
 */

const MAGIC = 'FOLIABTW'
const TRAILER = MAGIC.length + 8

const readBigUint64LE = (view: DataView, offset: number): number => {
  const low = view.getUint32(offset, true)
  const high = view.getUint32(offset + 4, true)
  return high * 2 ** 32 + low
}

export interface PackedModel<TManifest> {
  weights: Uint8Array<ArrayBuffer>
  manifest: TManifest
}

export const unpackModelWeights = <TManifest extends { bytes: number }>(
  file: Uint8Array<ArrayBuffer>,
): PackedModel<TManifest> => {
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
  const tail = file.byteLength - TRAILER
  if (tail < 0) throw new Error('not a packed model export (shorter than its trailer)')
  const magic = new TextDecoder('latin1').decode(file.subarray(file.byteLength - TRAILER, file.byteLength - 8))
  if (magic !== MAGIC) throw new Error('not a packed model export (no FOLIABTW trailer)')
  const at = readBigUint64LE(view, file.byteLength - 8)
  if (!(at > 0 && at < file.byteLength - TRAILER)) throw new Error(`manifest offset ${at} is outside the file`)
  const manifest = JSON.parse(
    new TextDecoder('utf-8').decode(file.subarray(at, file.byteLength - TRAILER)),
  ) as TManifest
  if (manifest.bytes !== at) throw new Error(`the tensors are ${at} bytes, the manifest says ${manifest.bytes}`)
  return { weights: file.subarray(0, at), manifest }
}

export type PackedBeatThis = PackedModel<BeatThisWgslManifest>
