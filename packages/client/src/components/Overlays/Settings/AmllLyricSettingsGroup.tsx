import { Input } from '@/components/ui/input'
import { NumericInput } from '@/components/ui/numeric-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingRow } from './SettingRow'

/** AMLL 歌词控制的所属播放器族 —— 两族各持一份独立存储（schema v4）。 */
export type AmllLyricFamily = 'classic' | 'mineradio'

type State = ReturnType<typeof useSettingsStore.getState>

interface Control<T> {
  value: T
  defaultValue: T
  set: (value: T) => void
}

function resetOf<T>(control: Control<T>) {
  return control.value !== control.defaultValue ? () => control.set(control.defaultValue) : undefined
}

function familyControls(s: State, family: AmllLyricFamily) {
  const m = family === 'mineradio'
  const pick = <T,>(classic: T, mineradio: T) => (m ? mineradio : classic)

  return {
    alignAnchor: {
      value: pick(s.classicLyricAlignAnchor, s.mineradioLyricAlignAnchor),
      defaultValue: pick(s.classicLyricAlignAnchorDefault, s.mineradioLyricAlignAnchorDefault),
      set: pick(s.setClassicLyricAlignAnchor, s.setMineradioLyricAlignAnchor),
    },
    alignPosition: {
      value: pick(s.classicLyricAlignPosition, s.mineradioLyricAlignPosition),
      defaultValue: pick(s.classicLyricAlignPositionDefault, s.mineradioLyricAlignPositionDefault),
      set: pick(s.setClassicLyricAlignPosition, s.setMineradioLyricAlignPosition),
    },
    enableSpring: {
      value: pick(s.classicLyricEnableSpring, s.mineradioLyricEnableSpring),
      defaultValue: pick(s.classicLyricEnableSpringDefault, s.mineradioLyricEnableSpringDefault),
      set: pick(s.setClassicLyricEnableSpring, s.setMineradioLyricEnableSpring),
    },
    enableBlur: {
      value: pick(s.classicLyricEnableBlur, s.mineradioLyricEnableBlur),
      defaultValue: pick(s.classicLyricEnableBlurDefault, s.mineradioLyricEnableBlurDefault),
      set: pick(s.setClassicLyricEnableBlur, s.setMineradioLyricEnableBlur),
    },
    enableScale: {
      value: pick(s.classicLyricEnableScale, s.mineradioLyricEnableScale),
      defaultValue: pick(s.classicLyricEnableScaleDefault, s.mineradioLyricEnableScaleDefault),
      set: pick(s.setClassicLyricEnableScale, s.setMineradioLyricEnableScale),
    },
    hidePassedLines: {
      value: pick(s.classicLyricHidePassedLines, s.mineradioLyricHidePassedLines),
      defaultValue: pick(s.classicLyricHidePassedLinesDefault, s.mineradioLyricHidePassedLinesDefault),
      set: pick(s.setClassicLyricHidePassedLines, s.setMineradioLyricHidePassedLines),
    },
    showBottomLine: {
      value: pick(s.classicLyricShowBottomLine, s.mineradioLyricShowBottomLine),
      defaultValue: pick(s.classicLyricShowBottomLineDefault, s.mineradioLyricShowBottomLineDefault),
      set: pick(s.setClassicLyricShowBottomLine, s.setMineradioLyricShowBottomLine),
    },
    maskMode: {
      value: pick(s.classicLyricMaskObsceneWordsMode, s.mineradioLyricMaskObsceneWordsMode),
      defaultValue: pick(s.classicLyricMaskObsceneWordsModeDefault, s.mineradioLyricMaskObsceneWordsModeDefault),
      set: pick(s.setClassicLyricMaskObsceneWordsMode, s.setMineradioLyricMaskObsceneWordsMode),
    },
    maskChar: {
      value: pick(s.classicLyricMaskObsceneWordChar, s.mineradioLyricMaskObsceneWordChar),
      defaultValue: pick(s.classicLyricMaskObsceneWordCharDefault, s.mineradioLyricMaskObsceneWordCharDefault),
      set: pick(s.setClassicLyricMaskObsceneWordChar, s.setMineradioLyricMaskObsceneWordChar),
    },
    wordFadeWidth: {
      value: pick(s.classicLyricWordFadeWidth, s.mineradioLyricWordFadeWidth),
      defaultValue: pick(s.classicLyricWordFadeWidthDefault, s.mineradioLyricWordFadeWidthDefault),
      set: pick(s.setClassicLyricWordFadeWidth, s.setMineradioLyricWordFadeWidth),
    },
    showTranslation: {
      value: pick(s.classicLyricShowTranslation, s.mineradioLyricShowTranslation),
      defaultValue: pick(s.classicLyricShowTranslationDefault, s.mineradioLyricShowTranslationDefault),
      set: pick(s.setClassicLyricShowTranslation, s.setMineradioLyricShowTranslation),
    },
    showRoman: {
      value: pick(s.classicLyricShowRoman, s.mineradioLyricShowRoman),
      defaultValue: pick(s.classicLyricShowRomanDefault, s.mineradioLyricShowRomanDefault),
      set: pick(s.setClassicLyricShowRoman, s.setMineradioLyricShowRoman),
    },
    swapTransRoman: {
      value: pick(s.classicLyricSwapTransRoman, s.mineradioLyricSwapTransRoman),
      defaultValue: pick(s.classicLyricSwapTransRomanDefault, s.mineradioLyricSwapTransRomanDefault),
      set: pick(s.setClassicLyricSwapTransRoman, s.setMineradioLyricSwapTransRoman),
    },
    fontWeight: {
      value: pick(s.classicLyricFontWeight, s.mineradioLyricFontWeight),
      defaultValue: pick(s.classicLyricFontWeightDefault, s.mineradioLyricFontWeightDefault),
      set: pick(s.setClassicLyricFontWeight, s.setMineradioLyricFontWeight),
    },
    fontSize: {
      value: pick(s.classicLyricFontSize, s.mineradioLyricFontSize),
      defaultValue: pick(s.classicLyricFontSizeDefault, s.mineradioLyricFontSizeDefault),
      set: pick(s.setClassicLyricFontSize, s.setMineradioLyricFontSize),
    },
  }
}

/** 敏感词遮罩两行：WebGL 歌词与 AMLL 读同一份设置，两个入口共用。 */
export function ObsceneMaskSettings({ family }: { family: AmllLyricFamily }) {
  const s = useSettingsStore()
  const c = familyControls(s, family)

  return (
    <>
      <SettingRow label="敏感词遮罩" description="仅处理歌词数据中已标记的敏感词" onReset={resetOf(c.maskMode)}>
        <Select
          value={c.maskMode.value || 'disabled'}
          onValueChange={(value) => c.maskMode.set(value === 'disabled' ? '' : (value as 'full-mask' | 'partial-mask'))}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="disabled">关闭</SelectItem>
            <SelectItem value="full-mask">全部遮罩</SelectItem>
            <SelectItem value="partial-mask">首尾保留</SelectItem>
          </SelectContent>
        </Select>
      </SettingRow>

      {c.maskMode.value && (
        <SettingRow label="遮罩字符" description="用于替换敏感词的单个字符" onReset={resetOf(c.maskChar)}>
          <Input
            value={c.maskChar.value}
            maxLength={1}
            onChange={(event) => c.maskChar.set(event.target.value)}
            className="w-16 text-center"
            aria-label="敏感词遮罩字符"
          />
        </SettingRow>
      )}
    </>
  )
}

export function AmllLyricSettingsGroup({ family }: { family: AmllLyricFamily }) {
  const s = useSettingsStore()
  const c = familyControls(s, family)

  return (
    <>
      <div>
        <h3 className="text-base font-semibold">歌词布局</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label="对齐锚点" description="当前歌词行在视口中的锚定方式" onReset={resetOf(c.alignAnchor)}>
          <Select
            value={c.alignAnchor.value}
            onValueChange={(v) => c.alignAnchor.set(v as 'top' | 'center' | 'bottom')}
          >
            <SelectTrigger className="w-28">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="top">顶部</SelectItem>
              <SelectItem value="center">居中</SelectItem>
              <SelectItem value="bottom">底部</SelectItem>
            </SelectContent>
          </Select>
        </SettingRow>

        <SettingRow
          label="对齐位置"
          description={`当前: ${Math.round(c.alignPosition.value * 100)}%`}
          onReset={resetOf(c.alignPosition)}
        >
          <Slider
            value={[c.alignPosition.value * 100]}
            min={0}
            max={100}
            step={5}
            onValueChange={(v) => c.alignPosition.set(v[0] / 100)}
            className="w-32"
          />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词内容</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label="显示翻译歌词" description="在原文下方显示翻译行" onReset={resetOf(c.showTranslation)}>
          <Switch checked={c.showTranslation.value} onCheckedChange={c.showTranslation.set} />
        </SettingRow>

        <SettingRow label="显示音译歌词" description="在原文下方显示音译行" onReset={resetOf(c.showRoman)}>
          <Switch checked={c.showRoman.value} onCheckedChange={c.showRoman.set} />
        </SettingRow>

        <SettingRow
          label="交换翻译与音译"
          description="把音译行显示在翻译行上方"
          onReset={resetOf(c.swapTransRoman)}
        >
          <Switch checked={c.swapTransRoman.value} onCheckedChange={c.swapTransRoman.set} />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词动画</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label="弹簧动画" description="歌词行切换时的弹簧物理效果" onReset={resetOf(c.enableSpring)}>
          <Switch checked={c.enableSpring.value} onCheckedChange={c.enableSpring.set} />
        </SettingRow>

        <SettingRow label="模糊效果" description="非当前行歌词模糊" onReset={resetOf(c.enableBlur)}>
          <Switch checked={c.enableBlur.value} onCheckedChange={c.enableBlur.set} />
        </SettingRow>

        <SettingRow label="缩放效果" description="当前行歌词放大突出显示" onReset={resetOf(c.enableScale)}>
          <Switch checked={c.enableScale.value} onCheckedChange={c.enableScale.set} />
        </SettingRow>

        <SettingRow
          label="逐词渐变宽度"
          description={`当前：${c.wordFadeWidth.value.toFixed(2)} 倍字号`}
          onReset={resetOf(c.wordFadeWidth)}
        >
          <Slider
            value={[c.wordFadeWidth.value * 100]}
            min={5}
            max={200}
            step={5}
            onValueChange={(v) => c.wordFadeWidth.set(v[0] / 100)}
            className="w-32"
          />
        </SettingRow>
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词交互</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow
          label="隐藏已播放歌词"
          description="逐渐收起当前进度之前的歌词行"
          onReset={resetOf(c.hidePassedLines)}
        >
          <Switch checked={c.hidePassedLines.value} onCheckedChange={c.hidePassedLines.set} />
        </SettingRow>

        <SettingRow
          label="显示歌词底栏"
          description="在歌词末尾显示当前歌曲和歌手信息"
          onReset={resetOf(c.showBottomLine)}
        >
          <Switch checked={c.showBottomLine.value} onCheckedChange={c.showBottomLine.set} />
        </SettingRow>

        <ObsceneMaskSettings family={family} />
      </div>

      <div>
        <h3 className="text-base font-semibold">歌词字体</h3>
        <Separator className="mt-2 mb-4" />

        <SettingRow label="字体粗细" description="字体粗细值（100-900）" onReset={resetOf(c.fontWeight)}>
          <NumericInput value={c.fontWeight.value} onChange={c.fontWeight.set} min={100} max={900} />
        </SettingRow>

        <SettingRow label="字体大小" description="主歌词字号比例（10-200）" onReset={resetOf(c.fontSize)}>
          <NumericInput value={c.fontSize.value} onChange={c.fontSize.set} />
        </SettingRow>

        <SettingRow
          label="翻译字号"
          description="翻译行相对主歌词的字号（10-200）"
          onReset={
            s.lyricTranslationFontSize !== s.lyricTranslationFontSizeDefault
              ? s.resetLyricTranslationFontSize
              : undefined
          }
        >
          <NumericInput value={s.lyricTranslationFontSize} onChange={s.setLyricTranslationFontSize} />
        </SettingRow>

        <SettingRow
          label="音译字号"
          description="音译行相对主歌词的字号（10-200）"
          onReset={
            s.lyricRomanFontSize !== s.lyricRomanFontSizeDefault ? s.resetLyricRomanFontSize : undefined
          }
        >
          <NumericInput value={s.lyricRomanFontSize} onChange={s.setLyricRomanFontSize} />
        </SettingRow>

        <SettingRow
          label="字体族"
          description="留空沿用 AMLL 默认字体；可填写系统字体名或字体栈"
          onReset={s.lyricFontFamily !== s.lyricFontFamilyDefault ? s.resetLyricFontFamily : undefined}
        >
          <Input
            value={s.lyricFontFamily}
            onChange={(e) => s.setLyricFontFamily(e.target.value)}
            placeholder="例如 PingFang SC, Noto Sans SC"
            className="w-52"
            spellCheck={false}
          />
        </SettingRow>

        <SettingRow
          label="字距"
          description="CSS letter-spacing，例如 0.02em；留空沿用默认"
          onReset={s.lyricLetterSpacing !== s.lyricLetterSpacingDefault ? s.resetLyricLetterSpacing : undefined}
        >
          <Input
            value={s.lyricLetterSpacing}
            onChange={(e) => s.setLyricLetterSpacing(e.target.value)}
            placeholder="例如 0.02em"
            className="w-28"
            spellCheck={false}
          />
        </SettingRow>
      </div>
    </>
  )
}
