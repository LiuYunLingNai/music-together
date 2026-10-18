import { registerVisualizerBackground } from './registry';
import common from './common/entry';
import latent from './latent/entry';
import monet from './monet/entry';
import nomand from './nomand/entry';
import sora from './sora/entry';
import url from './url/entry';

// 上游在 registry.tsx 里用 `import.meta.glob('./*/entry.tsx', { eager: true })` 完成注册。
// 本项目把这些 entry 静态列在这里，由 `FoliaPlayerStage` 引入一次（模块只执行一次，注册幂等）。
for (const entry of [common, monet, nomand, latent, url, sora]) {
    registerVisualizerBackground(entry);
}
