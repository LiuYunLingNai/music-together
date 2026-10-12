import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 客户端生产构建入口（替代直接调 `vite build`）。
 *
 * ============================ 为什么需要这个包装 ============================
 *
 * Vite 的 `vite:esbuild-transpile` 插件会把每个输出 chunk 交给 esbuild 再
 * 过一遍。esbuild 的 JS 包装层在**输入超过 1 MB** 时会改走临时文件路径
 * （`esbuild/lib/main.js:774`）：
 *
 *   ```js
 *   if (input.length > 1024 * 1024) start = () => fs.writeFile(input, next)
 *   ```
 *
 * 它把内容写到 `os.tmpdir()` 下，再让 Go 二进制删掉该文件。在本机环境下，
 * 当 `TEMP` 指向 `C:\Users\...\AppData\Local\Temp` 时，这个删除会返回
 * `Access is denied`，于是整个构建失败：
 *
 *   [vite:esbuild-transpile] remove C:\Users\...\Temp\esbuild-<hash>: Access is denied.
 *
 * 而本仓库的 `MineradioPlayerStage` chunk（three.js + 粒子场景）约 1.04 MB，
 * 恰好越过这条 1 MB 线，因此**每次**构建都会踩中。该 chunk 在本次 folia
 * 移植之前就已超过 1 MB（已在原始 HEAD 上复现），与移植无关。
 *
 * 实测：把 `TEMP` 指到**工作区内**的目录即可绕过 —— 同样的 esbuild 调用
 * 立刻成功。因此这里在加载 Vite（以及 esbuild）之前，先把进程内的
 * `TEMP`/`TMP` 改到仓库内的 `.esbtmp/`。
 *
 * ★ 为什么用 Vite 的 **JS API** 而不是 `spawn('vite', ['build'])`：
 *   不需要子进程、不涉及 stdio 捕获，且环境变量在**同一进程**内生效 ——
 *   esbuild 的 `randomFileName()` 是惰性调用 `os.tmpdir()`，因此只要在
 *   `build()` 之前改好就一定被读到。配置文件（`vite.config.ts`）仍按
 *   cwd 正常加载，行为与 `vite build` 等价。
 *
 * ★ 为什么用**动态** `import('vite')`：ESM 的静态 import 会被提升到模块
 *   顶部求值，那样环境变量还没设好，Vite/esbuild 就可能已经把 tmpdir 读走。
 *   动态 import 保证顺序。
 *
 * `.esbtmp/` 已在根 `.gitignore` 中忽略（里面是 node 编译缓存等可再生内容）。
 *
 * 若将来 esbuild 修好了这个删除问题，或者本机换到 `TEMP` 可正常删除的
 * 环境，可以直接把 `build` 脚本改回 `vite build`，本文件即可删除。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const clientRoot = path.resolve(here, '..')
const tempDir = path.join(clientRoot, '.esbtmp')

mkdirSync(tempDir, { recursive: true })

// 必须在 import('vite') 之前设置：见文件头说明。
process.env.TEMP = tempDir
process.env.TMP = tempDir

const { build } = await import('vite')

try {
  await build()
} catch (error) {
  console.error(error)
  process.exit(1)
}
