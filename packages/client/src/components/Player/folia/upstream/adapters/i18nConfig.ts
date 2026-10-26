import { t } from './i18n'

/**
 * 上游 `i18n/config` 的宿主版本。
 *
 * 上游的上传动作里直接调 `i18n.t('notifications.xxx')`（不在组件里，没有 `useTranslation`）。
 * 本仓的文案在 `adapters/labels.json`，这里给出同形的 `t`。
 */
const i18n = { t }
export default i18n
