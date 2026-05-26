import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import { readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'

const originalEnv = { ...process.env }
const originalMacro = (globalThis as Record<string, unknown>).MACRO
const hadOriginalMacro = Object.hasOwn(globalThis, 'MACRO')

let tempDirs: string[] = []

beforeEach(async () => {
  await acquireSharedMutationLock('utils/nativeInstaller/download.test.ts')
  process.env = { ...originalEnv }
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@makerbi/openclaude',
  }
  delete process.env.USER_TYPE
  tempDirs = []
})

afterEach(async () => {
  try {
    process.env = { ...originalEnv }
    if (hadOriginalMacro) {
      ;(globalThis as Record<string, unknown>).MACRO = originalMacro
    } else {
      delete (globalThis as Record<string, unknown>).MACRO
    }
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
      value.startsWith('win32') ? 'openclaude.exe' : 'openclaude',
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

test('external latest falls back to GitHub release redirect when API is rate limited', async () => {
  const curlCalls: string[][] = []
  mockAxiosGet(url => {
    expect(url).toBe(
      'https://api.github.com/repos/AndersonBY/openclaude/releases/latest',
    )
    const error = new Error('Request failed with status code 403')
    ;(error as Error & { response?: { status: number } }).response = {
      status: 403,
    }
    throw error
  })

  mock.module('../execFileNoThrow.js', () => ({
    execFileNoThrowWithCwd: async (command: string, args: string[]) => {
      curlCalls.push([command, ...args])
      return {
        code: 0,
        stderr: '',
        stdout: 'https://github.com/AndersonBY/openclaude/releases/tag/v0.14.8',
      }
    },
  }))

  const { getLatestVersion } = await importFreshDownload()

  await expect(getLatestVersion('latest')).resolves.toBe('0.14.8')
  expect(curlCalls).toHaveLength(1)
  expect(curlCalls[0]?.join(' ')).toContain(
    'https://github.com/AndersonBY/openclaude/releases/latest',
  )
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
              asset: 'openclaude-linux-x64',
            },
          },
        },
      }
    }

    if (
      url ===
      'https://github.com/AndersonBY/openclaude/releases/download/v0.14.3/openclaude-linux-x64'
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
  await expect(readFile(join(stagingPath, 'openclaude'))).resolves.toEqual(
    payload,
  )
  expect(calls).toEqual([
    'https://github.com/AndersonBY/openclaude/releases/download/v0.14.3/manifest.json',
    'https://github.com/AndersonBY/openclaude/releases/download/v0.14.3/openclaude-linux-x64',
  ])
})

test('external GitHub Release manifest fetch allows slow connections', async () => {
  mockInstaller('win32-x64')
  const payload = Buffer.from('native openclaude windows binary')
  const requests: { url: string; timeout?: unknown }[] = []

  mock.module('axios', () => {
    const axios = {
      get: async (url: string, config: { timeout?: number } = {}) => {
        requests.push({ url, timeout: config.timeout })
        if (
          url ===
          'https://github.com/AndersonBY/openclaude/releases/download/v0.14.4/manifest.json'
        ) {
          return {
            data: {
              platforms: {
                'win32-x64': {
                  checksum: sha256(payload),
                  asset: 'openclaude-win32-x64.exe',
                },
              },
            },
          }
        }

        if (
          url ===
          'https://github.com/AndersonBY/openclaude/releases/download/v0.14.4/openclaude-win32-x64.exe'
        ) {
          return { data: payload }
        }

        throw new Error(`Unexpected URL: ${url}`)
      },
      isAxiosError: () => false,
      isCancel: () => false,
    }
    return { default: axios }
  })
  const stagingPath = join(
    tmpdir(),
    `openclaude-download-timeout-test-${Date.now()}-${Math.random()}`,
  )
  tempDirs.push(stagingPath)

  const { downloadVersion } = await importFreshDownload()

  await expect(downloadVersion('0.14.4', stagingPath)).resolves.toBe('binary')
  expect(
    requests.find(request => request.url.endsWith('/manifest.json'))?.timeout,
  ).toBeGreaterThanOrEqual(30000)
})

test('external GitHub Release manifest fetch falls back to curl after network failure', async () => {
  mockInstaller('win32-x64')
  const payload = Buffer.from('native openclaude windows binary')
  const curlCalls: string[][] = []

  mockAxiosGet(url => {
    if (
      url ===
      'https://github.com/AndersonBY/openclaude/releases/download/v0.14.7/manifest.json'
    ) {
      throw new Error('connect ETIMEDOUT 198.18.5.9:443')
    }

    if (
      url ===
      'https://github.com/AndersonBY/openclaude/releases/download/v0.14.7/openclaude-win32-x64.exe'
    ) {
      return { data: payload }
    }

    throw new Error(`Unexpected URL: ${url}`)
  })

  mock.module('../execFileNoThrow.js', () => ({
    execFileNoThrowWithCwd: async (command: string, args: string[]) => {
      curlCalls.push([command, ...args])
      return {
        code: 0,
        stderr: '',
        stdout: JSON.stringify({
          platforms: {
            'win32-x64': {
              checksum: sha256(payload),
              asset: 'openclaude-win32-x64.exe',
            },
          },
        }),
      }
    },
  }))

  const stagingPath = join(
    tmpdir(),
    `openclaude-download-curl-test-${Date.now()}-${Math.random()}`,
  )
  tempDirs.push(stagingPath)

  const { downloadVersion } = await importFreshDownload()

  await expect(downloadVersion('0.14.7', stagingPath)).resolves.toBe('binary')
  await expect(readFile(join(stagingPath, 'openclaude.exe'))).resolves.toEqual(
    payload,
  )
  expect(curlCalls).toHaveLength(1)
  expect(curlCalls[0]?.join(' ')).toContain(
    'https://github.com/AndersonBY/openclaude/releases/download/v0.14.7/manifest.json',
  )
})

test('external GitHub Release binary download falls back to curl after network failure', async () => {
  mockInstaller('win32-x64')
  const payload = Buffer.from('native openclaude windows binary')
  const curlCalls: string[][] = []

  mockAxiosGet(url => {
    if (
      url ===
      'https://github.com/AndersonBY/openclaude/releases/download/v0.14.7/manifest.json'
    ) {
      return {
        data: {
          platforms: {
            'win32-x64': {
              checksum: sha256(payload),
              asset: 'openclaude-win32-x64.exe',
            },
          },
        },
      }
    }

    if (
      url ===
      'https://github.com/AndersonBY/openclaude/releases/download/v0.14.7/openclaude-win32-x64.exe'
    ) {
      throw new Error('connect ETIMEDOUT 198.18.5.9:443')
    }

    throw new Error(`Unexpected URL: ${url}`)
  })

  mock.module('../execFileNoThrow.js', () => ({
    execFileNoThrowWithCwd: async (command: string, args: string[]) => {
      curlCalls.push([command, ...args])
      const outputIndex = args.indexOf('--output')
      if (outputIndex >= 0) {
        await writeFile(args[outputIndex + 1]!, payload)
      }
      return {
        code: 0,
        stderr: '',
        stdout: '',
      }
    },
  }))

  const stagingPath = join(
    tmpdir(),
    `openclaude-download-curl-binary-test-${Date.now()}-${Math.random()}`,
  )
  tempDirs.push(stagingPath)

  const { downloadVersion } = await importFreshDownload()

  await expect(downloadVersion('0.14.7', stagingPath)).resolves.toBe('binary')
  await expect(readFile(join(stagingPath, 'openclaude.exe'))).resolves.toEqual(
    payload,
  )
  expect(curlCalls).toHaveLength(1)
  expect(curlCalls[0]?.join(' ')).toContain(
    'https://github.com/AndersonBY/openclaude/releases/download/v0.14.7/openclaude-win32-x64.exe',
  )
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
              asset: 'openclaude-linux-x64',
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
