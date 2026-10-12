import type { ReactNode } from 'react'
import { resolveThemeFontStack, resolveThemeFontWeight } from '../lib/fontStacks'
import type { Theme } from '../types'

interface FoliaShellProps {
  theme: Theme
  className?: string
  children: ReactNode
}

/**
 * Folia 舞台的共享外壳 —— 上游 `VisualizerShell.tsx` 的**刻意最小化替代**。
 *
 * ============================ 为什么不能照搬上游 ============================
 *
 * 上游的 shell 是静态 import 到**每一个**模式里的，而它自身牵入：
 *
 *   - `backgrounds/VisualizerBackgroundRenderer` → `backgrounds/registry.tsx`
 *     的 `import.meta.glob`（eager glob 子目录下的 entry）—— 会**急切**
 *     打包全部背景，含 `SoraBackground.tsx`（twgl.js）与
 *     `LatentBackground.tsx` / `NomandBackgroundLayer.tsx`
 *     （@paper-design/shaders）；
 *   - `mods/folium/registries/stageLayers`（上游的 mod 系统）；
 *   - `videoLayer/VideoLayer`；
 *   - `utils/appSurface`。
 *
 * 本项目在 FoliaPlayerStage 中独立组合按需加载的背景和控制栏。
 * 模式外壳仅负责透明容器与字体栈/字重注入，不导入背景注册表。
 *
 * ★ 上游 shell 还负责 hover 返回按钮与右下角热点（播放器面板引导）。这两者
 *   属于上游 Electron 的窗口语义；本项目的播放器是房间页里的一层，返回与
 *   面板开关都由 `RoomPage` / 经典舞台自己的按钮承担，舞台内不应再放一份
 *   会与它们抢位置的浮层。
 *
 * ★ 上游 shell 还接收 `audioPower` / `audioBands` 并交给背景层做音频响应。
 *   本项目的这五个模式**都不消费音频**（已逐一核对：模式与全部共享 helper
 *   里 `audioPower` / `audioBands` / `spectrum` 零次实际读取）。移植的背景
 *   使用封面/主题与独立动画时钟，因此外壳不接收音频占位 prop。
 */
export function FoliaShell({ theme, className = '', children }: FoliaShellProps) {
  return (
    <div
      className={`relative flex h-full w-full flex-col items-center justify-center overflow-hidden ${className}`.trim()}
      style={{
        // 透明前景，独立的 FoliaBackground 在舞台宿主中铺底。
        backgroundColor: 'transparent',
        fontFamily: resolveThemeFontStack(theme),
        fontWeight: resolveThemeFontWeight(theme, 400),
      }}
    >
      {children}
    </div>
  )
}
