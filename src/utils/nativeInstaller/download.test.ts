import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalEnv = { ...process.env }

let tempDirs: string[] = []

beforeEach(async () => {
  await acquireSharedMutationLock('utils/nativeInstaller/download.test.ts')
  process.env = { ...originalEnv }
  delete process.env.USER_TYPE
  tempDirs = []
})

afterEach(async () => {
  try {
    process.env = { ...originalEnv }
    mock.restore()
    await Promise.all(
      tempDirs.map(dir => rm(dir, { recursive: true, force: true })),
    )
  } finally {
    releaseSharedMutationLock()
  }
})

function importFreshDownload() {
  return import(`./download.ts?ts=${Date.now()}-${Math.random()}`)
}

function mockInstaller(platform = 'linux-x64') {
  mock.module('./installer.js', () => ({
    getPlatform: () => platform,
    getBinaryName: (value: string) =>
      value.startsWith('win32') ? 'claude.exe' : 'claude',
  }))
}

function mockAxiosGet(
  handler: (url: string) => { data: unknown } | Promise<{ data: unknown }>,
) {
  const calls: string[] = []
  mock.module('axios', () => {
    const axios = {
      get: async (url: string) => {
        calls.push(url)
        return handler(url)
      },
      isAxiosError: () => false,
      isCancel: () => false,
    }
    return { default: axios }
  })
  return calls
}

function sha256(data: Buffer) {
  return createHash('sha256').update(data).digest('hex')
}

test('external latest resolves from AndersonBY GitHub Releases', async () => {
  mockInstaller()
  const calls = mockAxiosGet(url => {
    expect(url).toBe(
      'https://api.github.com/repos/AndersonBY/openclaude/releases/latest',
    )
    return { data: { tag_name: 'v0.14.3' } }
  })

  const { getLatestVersion } = await importFreshDownload()

  await expect(getLatestVersion('latest')).resolves.toBe('0.14.3')
  expect(calls).toEqual([
    'https://api.github.com/repos/AndersonBY/openclaude/releases/latest',
  ])
})

test('external stable resolves first non-prerelease AndersonBY GitHub Release', async () => {
  mockInstaller()
  const calls = mockAxiosGet(url => {
    expect(url).toBe(
      'https://api.github.com/repos/AndersonBY/openclaude/releases?per_page=20',
    )
    return {
      data: [
        { tag_name: 'v0.14.4', prerelease: true, draft: false },
        { tag_name: 'v0.14.3', prerelease: false, draft: false },
      ],
    }
  })

  const { getLatestVersion } = await importFreshDownload()

  await expect(getLatestVersion('stable')).resolves.toBe('0.14.3')
  expect(calls).toEqual([
    'https://api.github.com/repos/AndersonBY/openclaude/releases?per_page=20',
  ])
})

test('external binary downloads GitHub Release asset and stages canonical executable name', async () => {
  mockInstaller('linux-x64')
  const payload = Buffer.from('native openclaude binary')
  const calls = mockAxiosGet(url => {
    if (
      url ===
      'https://github.com/AndersonBY/openclaude/releases/download/v0.14.3/manifest.json'
    ) {
      return {
        data: {
          platforms: {
            'linux-x64': {
              checksum: sha256(payload),
              asset: 'claude-linux-x64',
            },
          },
        },
      }
    }

    if (
      url ===
      'https://github.com/AndersonBY/openclaude/releases/download/v0.14.3/claude-linux-x64'
    ) {
      return { data: payload }
    }

    throw new Error(`Unexpected URL: ${url}`)
  })
  const stagingPath = join(
    tmpdir(),
    `openclaude-download-test-${Date.now()}-${Math.random()}`,
  )
  tempDirs.push(stagingPath)

  const { downloadVersion } = await importFreshDownload()

  await expect(downloadVersion('0.14.3', stagingPath)).resolves.toBe('binary')
  await expect(readFile(join(stagingPath, 'claude'))).resolves.toEqual(payload)
  expect(calls).toEqual([
    'https://github.com/AndersonBY/openclaude/releases/download/v0.14.3/manifest.json',
    'https://github.com/AndersonBY/openclaude/releases/download/v0.14.3/claude-linux-x64',
  ])
})

test('external binary reports missing GitHub Release platform clearly', async () => {
  mockInstaller('darwin-arm64')
  mockAxiosGet(url => {
    if (
      url ===
      'https://github.com/AndersonBY/openclaude/releases/download/v0.14.3/manifest.json'
    ) {
      return {
        data: {
          platforms: {
            'linux-x64': {
              checksum: sha256(Buffer.from('linux')),
              asset: 'claude-linux-x64',
            },
          },
        },
      }
    }

    throw new Error(`Unexpected URL: ${url}`)
  })
  const stagingPath = join(
    tmpdir(),
    `openclaude-download-test-${Date.now()}-${Math.random()}`,
  )
  tempDirs.push(stagingPath)

  const { downloadVersion } = await importFreshDownload()

  await expect(downloadVersion('0.14.3', stagingPath)).rejects.toThrow(
    'Platform darwin-arm64 not found in manifest for version 0.14.3',
  )
})
