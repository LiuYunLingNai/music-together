import { useState } from 'react'
import { resolveThemeFontStack, resolveThemeFontWeight, resolveThemeTranslationFontStack } from '../../lib/fontStacks'
import type { FoliaSharedProps } from '../../definition'
import { FoliaShell } from '../../stage/FoliaShell'
import { resolveLyricSubtitleTracks } from '../../lib/alternateText'

/**
 * Still —— 静态低资源歌词模式。
 *
 * 移植自 folia-major `src/components/visualizer/still/VisualizerStill.tsx`。
 * 显示当前行 ±1 行，用透明度与字号区分主次；不挂背景层、不读音频、
 * **完全不读 `currentTime`**（只用 `currentLineIndex`），因此是五个模式里
 * 最轻的一个，也是 WebGL/动画出问题时的理想回退。
 *
 * 与上游的唯一差异：外壳换成 `FoliaShell`（上游 shell 会牵入背景与 mod 系统，
 * 见该文件说明）。歌词内容、行数、透明度与字号逻辑逐字保留。
 */
export function VisualizerStill({
  currentLineIndex,
  lines,
  theme,
  subtitleTheme,
  lyricsFontScale = 1,
  subtitleFontScale = 1,
  hideTranslationSubtitle = false,
  subtitleContentMode = 'translation',
  showText = true,
}: FoliaSharedProps) {
  /**
   * 显示用的行下标。
   *
   * 语义（与上游一致）：当前行有效时用它；`currentLineIndex === -1`（间奏 /
   * 尚未起播）时**保留上一次有效行**，这样歌词不会在间奏里突然消失；
   * 若保留值已越界（换歌后行数变少）则回到 0。
   *
   * ★ 上游用 `useEffect` + `setState` 实现，会在 effect 里同步 setState
   *   （React Compiler 的 `react-hooks/set-state-in-effect` 会拒绝：那会造成
   *   级联渲染）。这里改用 React 官方推荐的"**渲染期按 prop 变化调整 state**"
   *   写法：只在 `currentLineIndex` 真的变化时调整，且 setState 被条件包住，
   *   因此不会死循环。行为与上游逐字等价。
   */
  const [lastActiveIndex, setLastActiveIndex] = useState(() => Math.max(0, currentLineIndex))
  const [prevLineIndex, setPrevLineIndex] = useState(currentLineIndex)
  if (prevLineIndex !== currentLineIndex) {
    setPrevLineIndex(currentLineIndex)
    if (currentLineIndex !== -1) {
      setLastActiveIndex(currentLineIndex)
    }
  }

  const effectiveIndex = currentLineIndex !== -1 ? currentLineIndex : lastActiveIndex >= lines.length ? 0 : lastActiveIndex

  const resolvedSubtitleTheme = subtitleTheme ?? theme

  return (
    <FoliaShell theme={theme} className="folia-still">
      {/* 中心向外的径向压暗：让居中的歌词从背景里"浮"出来 */}
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,transparent_0%,#000_100%)] opacity-[0.65]" />

      {showText && (
        <div className="pointer-events-none absolute inset-0 z-0 flex flex-col items-center justify-center gap-8 px-12 pb-16">
          {[-1, 0, 1].map((offset) => {
            const lineIndex = effectiveIndex + offset
            const line = lines[lineIndex]
            if (!line) {
              return <div key={`empty-${offset}`} className="h-20" />
            }

            const isCurrent = offset === 0
            return (
              <div key={lineIndex} className="flex w-full max-w-4xl flex-col items-center">
                {line.fullText && (
                  <div
                    className={`text-center tracking-[0.02em] drop-shadow-md ${
                      isCurrent ? 'text-[2.5rem] leading-tight opacity-100' : 'text-3xl opacity-30'
                    }`}
                    style={{
                      color: theme.primaryColor,
                      fontFamily: resolveThemeFontStack(theme),
                      scale: lyricsFontScale,
                      fontWeight: resolveThemeFontWeight(theme, isCurrent ? 700 : 600),
                    }}
                  >
                    {line.fullText}
                  </div>
                )}
                {!hideTranslationSubtitle && resolveLyricSubtitleTracks(line, subtitleContentMode).map((track) => (
                  <div
                    key={track.role}
                    className={`text-center tracking-wide drop-shadow-sm ${
                      isCurrent ? 'mt-3 text-2xl opacity-80' : 'mt-2 text-xl opacity-30'
                    }`}
                    style={{
                      color: resolvedSubtitleTheme.secondaryColor,
                      fontFamily: resolveThemeTranslationFontStack(resolvedSubtitleTheme),
                      scale: lyricsFontScale * subtitleFontScale,
                      fontWeight: resolveThemeFontWeight(resolvedSubtitleTheme, isCurrent ? 500 : 400),
                    }}
                  >
                    {track.text}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
    </FoliaShell>
  )
}
