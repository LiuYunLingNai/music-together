import { getVisualMode, type VisualModeId } from './shared/VisualMode'
import { LyricDisplay } from '../LyricDisplay'

interface MineradioLyricStageProps {
  mode: VisualModeId
  onLyricSeek: (time: number) => void
  /** 封面主色，用于歌词辉光与环境色统一 */
  accent: string | null
}

/**
 * Mineradio 模式下的歌词层。
 *
 * 继续使用现有的 AMLL DOM 渲染链路（`LyricDisplay` → `LyricPlayer`），
 * 因此逐字动画、TTML、LRC 回退、译词、音译、背景歌词、对唱方向、
 * 点击跳转与时间偏移校准全部保持不变。
 *
 * 立体感来自外层 CSS：透视 + 轻微旋转 + 缩放 + 遮罩，
 * 而不是把文字转成 WebGL 纹理。逐字高亮因此不会被替换。
 */
export function MineradioLyricStage({ mode, onLyricSeek, accent }: MineradioLyricStageProps) {
  const meta = getVisualMode(mode)

  return (
    <div
      className="mt-mineradio-lyrics"
      style={
        {
          '--mt-accent': accent ?? meta.ambient,
        } as React.CSSProperties
      }
    >
      {/* 空间化容器：把歌词平面推入场景纵深 */}
      <div className="mt-mineradio-lyrics__plane">
        <LyricDisplay onSeek={onLyricSeek} />
      </div>
    </div>
  )
}
