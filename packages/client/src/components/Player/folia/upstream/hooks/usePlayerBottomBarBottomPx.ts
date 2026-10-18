import { useMemo } from 'react';
import { motionValue, type MotionValue } from 'motion/react';

// 上游 `hooks/usePlayerBottomBarBottomPx.ts` 的 `usePlayerSubtitleBottomPx`：字幕层的 `bottom`
// 从播放页底栏布局的全局信号（`playerBottomBarLiveOffset` + 底栏设置 store + 布局 Context）取，
// 控制条出现/消失走 spring，跟随基线抬高直接读共享信号。
//
// 本项目没有那套 Electron 底栏布局：舞台把同样的基线算成 CSS 变量
// `--folia-subtitle-bottom`（见 `index.css` 的 `.folia-root`，跟随控制栏离底距离与响应式高度）。
// 这里把它包成同一个 hook 的形状 —— 上游字幕层因此可以原样绑定 `bottom`，
// 不必在组件里写宿主特判。
export const usePlayerSubtitleBottomPx = (isPlayerChromeHidden: boolean): MotionValue<string> => {
    void isPlayerChromeHidden;
    return useMemo(() => motionValue('var(--folia-subtitle-bottom, 6.5rem)'), []);
};
