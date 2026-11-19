export type SaveExportResult = 'saved' | 'cancelled'

/** Save the host settings panel's project through the browser download flow. */
export async function saveExportFile(name: string, data: Blob | string | ArrayBuffer | Uint8Array, mimeType = 'application/octet-stream'): Promise<SaveExportResult> {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name.replace(/[\\/]/g, '_')
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return 'saved'
}
