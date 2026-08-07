import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const serverDist = path.join(root, 'packages', 'server', 'dist')
const sharedDist = path.join(root, 'packages', 'shared', 'dist')
const bundledShared = path.join(serverDist, 'node_modules', '@music-together', 'shared')

await rm(bundledShared, { recursive: true, force: true })
await mkdir(bundledShared, { recursive: true })
await symlink(sharedDist, path.join(bundledShared, 'dist'), process.platform === 'win32' ? 'junction' : 'dir')

const packageJson = JSON.parse(await readFile(path.join(root, 'packages', 'shared', 'package.json'), 'utf8'))
await writeFile(
  path.join(bundledShared, 'package.json'),
  `${JSON.stringify(
    {
      name: packageJson.name,
      version: packageJson.version,
      type: 'module',
      main: './dist/index.js',
      types: './dist/index.d.ts',
      exports: {
        '.': {
          import: './dist/index.js',
          types: './dist/index.d.ts',
        },
      },
    },
    null,
    2,
  )}\n`,
)

console.log('Prepared server production dependencies in packages/server/dist/node_modules.')
