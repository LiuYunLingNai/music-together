import type { CappellaEmojiImage } from '../../types';

// src/components/visualizer/cappella/emoImages.ts
// Loads emoji images from the `emo` directory via Vite's import.meta.glob.

const emoModules = import.meta.glob<{ default: string }>(
    './emo/*.{png,jpg,jpeg,gif,webp,svg}',
    { eager: true },
);

const builtinEmoImages: CappellaEmojiImage[] = Object.entries(emoModules).map(
    ([path, mod]) => {
        const filename = path.split('/').pop() ?? '';
        const name = filename.replace(/\.[^.]+$/, '');
        return {
            id: `builtin-${name}`,
            url: mod.default,
            name,
        };
    },
);

/**
 * 从 emo 目录中随机挑选一张表情图片。
 *
 * ★ 上游（folia-major `cappella/emoImages.ts`）导出了 `pickRandomEmoImage`，
 *   但**全仓零调用点** —— 真正的表情挑选走 `cappellaMessages.ts` 里的
 *   `pickStableEmoImage`（按 seed 确定性挑选，同一首歌每次一样）。那个
 *   "随机挑"函数是死代码，且带一个未被使用的 `_emotionHint` 参数，会让
 *   `no-unused-vars` 报错。这里不再移植它。
 *
 *   表情挑选的**唯一入口**是 `pickStableEmoImage`，它消费下面导出的
 *   `builtinEmoImages`。
 */
export { builtinEmoImages };
