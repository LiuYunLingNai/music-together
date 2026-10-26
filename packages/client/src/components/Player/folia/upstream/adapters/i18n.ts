import labels from './labels.json'

// Folia visual labels only; the host's playback and identity domains do not depend on i18next.
export function t(key: string, values?: Record<string, unknown>): string {
  let current: unknown = labels
  for (const part of key.split('.')) current = current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined
  const text = typeof current === 'string' ? current : key.split('.').at(-1) ?? key
  return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))
}
const translation = { t }
export function useTranslation() { return translation }

/** 上游从 i18next 取 `TFunction` 类型；本仓没有 i18next，给出同形类型。 */
export type TFunction = (key: string, values?: Record<string, unknown>) => string;
