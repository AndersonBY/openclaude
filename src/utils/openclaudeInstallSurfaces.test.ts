import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { copyFileSync } from 'fs'
import * as fsPromises from 'fs/promises'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'
import * as realConfig from './config.js'
import * as realEnv from './env.js'
import * as realEnvUtils from './envUtils.js'
import * as realExecFileNoThrow from './execFileNoThrow.js'

const originalEnv = { ...process.env }
const originalMacro = (globalThis as Record<string, unknown>).MACRO

beforeEach(async () => {
  await acquireSharedMutationLock('utils/openclaudeInstallSurfaces.test.ts')
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    if (originalMacro === undefined) {
      delete (globalThis as Record<string, unknown>).MACRO
    } else {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    }
    mock.restore()
    mock.module('./config.js', () => realConfig)
    mock.module('../utils/env.js', () => realEnv)
    mock.module('./envUtils.js', () => realEnvUtils)
    mock.module('./execFileNoThrow.js', () => realExecFileNoThrow)
  } finally {
    releaseSharedMutationLock()
  }
})

async function importFreshInstallCommand() {
  return import(`../commands/install.tsx?ts=${Date.now()}-${Math.random()}`)
}

async function importFreshInstaller() {
  return import(`./nativeInstaller/installer.ts?ts=${Date.now()}-${Math.random()}`)
}

test('install command displays ~/.local/bin/openclaude on non-Windows', async () => {
  mock.module('../utils/env.js', () => ({
    ...realEnv,
    env: { platform: 'darwin' },
  }))

  const { getInstallationPath } = await importFreshInstallCommand()

  expect(getInstallationPath()).toBe('~/.local/bin/openclaude')
})

test('install command displays openclaude.exe path on Windows', async () => {
  mock.module('../utils/env.js', () => ({
    ...realEnv,
    env: { platform: 'win32' },
  }))

  const { getInstallationPath } = await importFreshInstallCommand()

  expect(getInstallationPath()).toBe(
    join(homedir(), '.local', 'bin', 'openclaude.exe').replace(/\//g, '\\'),
  )
})

test('native installer uses openclaude binary name for forked package', async () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@makerbi/openclaude',
  }

  const { getBinaryName, getCliBinaryName } = await importFreshInstaller()

  expect(getCliBinaryName()).toBe('openclaude')
  expect(getBinaryName('linux-x64')).toBe('openclaude')
  expect(getBinaryName('win32-x64')).toBe('openclaude.exe')
})

test('native installer preserves upstream claude binary name for upstream package', async () => {
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@anthropic-ai/claude-code',
  }

  const { getBinaryName, getCliBinaryName } = await importFreshInstaller()

  expect(getCliBinaryName()).toBe('claude')
  expect(getBinaryName('linux-x64')).toBe('claude')
  expect(getBinaryName('win32-x64')).toBe('claude.exe')
})

test('cleanupNpmInstallations removes both openclaude and legacy claude local install dirs', async () => {
  const removedPaths: string[] = []
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@makerbi/openclaude',
  }

  mock.module('fs/promises', () => ({
    ...fsPromises,
    rm: async (path: string) => {
      removedPaths.push(path)
    },
  }))

  mock.module('./execFileNoThrow.js', () => ({
    ...realExecFileNoThrow,
    execFileNoThrowWithCwd: async () => ({
      code: 1,
      stderr: 'npm ERR! code E404',
    }),
  }))

  mock.module('./envUtils.js', () => ({
    ...realEnvUtils,
    getClaudeConfigHomeDir: () => join(homedir(), '.openclaude'),
    isEnvTruthy: (value: string | undefined) => value === '1',
  }))

  const { cleanupNpmInstallations } = await importFreshInstaller()
  await cleanupNpmInstallations()

  expect(removedPaths).toContain(join(homedir(), '.openclaude', 'local'))
  expect(removedPaths).toContain(join(homedir(), '.claude', 'local'))
})

test('cleanupNpmInstallations does not uninstall the current openclaude npm shim', async () => {
  const uninstallTargets: string[] = []
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@makerbi/openclaude',
  }

  mock.module('fs/promises', () => ({
    ...fsPromises,
    rm: async () => {},
  }))

  mock.module('./execFileNoThrow.js', () => ({
    ...realExecFileNoThrow,
    execFileNoThrowWithCwd: async (_cmd: string, args: string[]) => {
      if (args[0] === 'uninstall') {
        uninstallTargets.push(args[2]!)
      }
      return {
        code: 1,
        stderr: 'npm ERR! code E404',
      }
    },
  }))

  mock.module('./envUtils.js', () => ({
    ...realEnvUtils,
    getClaudeConfigHomeDir: () => join(homedir(), '.openclaude'),
    isEnvTruthy: (value: string | undefined) => value === '1',
  }))

  const { cleanupNpmInstallations } = await importFreshInstaller()
  await cleanupNpmInstallations()

  expect(uninstallTargets).toEqual(['@anthropic-ai/claude-code'])
  expect(uninstallTargets).not.toContain('@makerbi/openclaude')
})

test('native installer replaces Windows launcher when same-sized binary content changes', async () => {
  const tempHome = join(
    tmpdir(),
    `openclaude-windows-launcher-test-${Date.now()}-${Math.random()}`,
  )
  const oldBinary = Buffer.from('old native binary')
  const newBinary = Buffer.from('new native binary')
  expect(oldBinary.length).toBe(newBinary.length)

  process.env = {
    ...originalEnv,
    HOME: tempHome,
    USERPROFILE: tempHome,
    XDG_DATA_HOME: join(tempHome, '.local', 'share'),
    XDG_CACHE_HOME: join(tempHome, '.cache'),
    XDG_STATE_HOME: join(tempHome, '.local', 'state'),
    ENABLE_LOCKLESS_UPDATES: '1',
  }
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@makerbi/openclaude',
    VERSION: '0.14.5',
  }

  mock.module('./env.js', () => ({
    ...realEnv,
    env: { platform: 'win32' },
  }))

  mock.module('./envDynamic.js', () => ({
    envDynamic: {
      isMuslEnvironment: () => false,
    },
  }))

  mock.module('./autoUpdater.js', () => ({
    getMaxVersion: async () => null,
    shouldSkipVersion: () => false,
  }))

  mock.module('./config.js', () => ({
    ...realConfig,
    getGlobalConfig: () => ({}),
    saveGlobalConfig: () => {},
  }))

  mock.module('./nativeInstaller/download.js', () => ({
    getLatestVersion: async () => '0.14.6',
    downloadVersion: async (_version: string, stagingPath: string) => {
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'openclaude.exe'), newBinary)
      return 'binary' as const
    },
  }))

  try {
    const launcherPath = join(tempHome, '.local', 'bin', 'openclaude.exe')
    await mkdir(join(tempHome, '.local', 'bin'), { recursive: true })
    await writeFile(launcherPath, oldBinary)

    const { installLatest } = await importFreshInstaller()

    await expect(installLatest('0.14.6', true)).resolves.toMatchObject({
      latestVersion: '0.14.6',
      wasUpdated: true,
    })
    await expect(readFile(launcherPath)).resolves.toEqual(newBinary)
  } finally {
    await rm(tempHome, { recursive: true, force: true })
  }
})

test('native installer fails Windows update if replacing the launcher copy fails', async () => {
  const tempHome = join(
    tmpdir(),
    `openclaude-windows-copy-failure-test-${Date.now()}-${Math.random()}`,
  )
  const oldBinary = Buffer.from('old native binary')
  const newBinary = Buffer.from('new native binary')
  const launcherPath = join(tempHome, '.local', 'bin', 'openclaude.exe')

  process.env = {
    ...originalEnv,
    HOME: tempHome,
    USERPROFILE: tempHome,
    XDG_DATA_HOME: join(tempHome, '.local', 'share'),
    XDG_CACHE_HOME: join(tempHome, '.cache'),
    XDG_STATE_HOME: join(tempHome, '.local', 'state'),
    ENABLE_LOCKLESS_UPDATES: '1',
  }
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@makerbi/openclaude',
    VERSION: '0.14.9',
  }

  mock.module('fs/promises', () => ({
    ...fsPromises,
    copyFile: async (from: string, to: string) => {
      if (to === launcherPath) {
        throw new Error('simulated launcher copy failure')
      }
      copyFileSync(from, to)
    },
  }))

  mock.module('./env.js', () => ({
    ...realEnv,
    env: { platform: 'win32' },
  }))

  mock.module('./envDynamic.js', () => ({
    envDynamic: {
      isMuslEnvironment: () => false,
    },
  }))

  mock.module('./autoUpdater.js', () => ({
    getMaxVersion: async () => null,
    shouldSkipVersion: () => false,
  }))

  mock.module('./config.js', () => ({
    ...realConfig,
    getGlobalConfig: () => ({}),
    saveGlobalConfig: () => {},
  }))

  mock.module('./nativeInstaller/download.js', () => ({
    getLatestVersion: async () => '0.15.0',
    downloadVersion: async (_version: string, stagingPath: string) => {
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'openclaude.exe'), newBinary)
      return 'binary' as const
    },
  }))

  try {
    await mkdir(join(tempHome, '.local', 'bin'), { recursive: true })
    await writeFile(launcherPath, oldBinary)

    const { installLatest } = await importFreshInstaller()

    await expect(installLatest('0.15.0', true)).rejects.toThrow(
      'simulated launcher copy failure',
    )
    await expect(readFile(launcherPath)).resolves.toEqual(oldBinary)
  } finally {
    await rm(tempHome, { recursive: true, force: true })
  }
})
