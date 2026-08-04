import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = path.join(rootDirectory, 'package.json')
const debugBuild = process.argv.includes('--debug')
const builderArgs = process.argv.slice(2).filter((argument) => argument !== '--debug')
const npmCli = process.env.npm_execpath

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: rootDirectory, stdio: 'inherit', ...options })
    child.once('error', reject)
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)))
  })
}

function runNpm(args) {
  if (npmCli) return run(process.execPath, [npmCli, ...args])
  return run(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { shell: process.platform === 'win32' })
}

const originalPackage = await readFile(packagePath)
const packageJson = JSON.parse(originalPackage.toString())
packageJson.debugBuild = debugBuild
await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`)

try {
  await runNpm(['run', 'build'])
  await runNpm(['exec', 'electron-builder', '--', '--win', ...builderArgs])
} finally {
  await writeFile(packagePath, originalPackage)
}
