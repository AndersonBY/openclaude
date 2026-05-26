import { afterEach, beforeEach, expect, mock, test } from 'bun:test'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalEnv = { ...process.env }

beforeEach(async () => {
  await acquireSharedMutationLock('utils/autoUpdater.githubReleases.test.ts')
  process.env = { ...originalEnv }
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

function importFreshAutoUpdater() {
  return import(`./autoUpdater.ts?ts=${Date.now()}-${Math.random()}`)
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
    }
    return { default: axios }
  })
  return calls
}

test('package-manager updater resolves latest from AndersonBY GitHub Releases', async () => {
  const calls = mockAxiosGet(url => {
    expect(url).toBe(
      'https://api.github.com/repos/AndersonBY/openclaude/releases/latest',
    )
    return { data: { tag_name: 'v0.14.3' } }
  })

  const { getLatestVersionFromGitHubReleases } = await importFreshAutoUpdater()

  await expect(getLatestVersionFromGitHubReleases('latest')).resolves.toBe(
    '0.14.3',
  )
  expect(calls).toEqual([
    'https://api.github.com/repos/AndersonBY/openclaude/releases/latest',
  ])
})

test('package-manager updater resolves stable from AndersonBY release list', async () => {
  const calls = mockAxiosGet(url => {
    expect(url).toBe(
      'https://api.github.com/repos/AndersonBY/openclaude/releases?per_page=20',
    )
    return {
      data: [
        { tag_name: 'v0.14.4', prerelease: true, draft: false },
        { tag_name: 'v0.14.3', prerelease: false, draft: false },
        { tag_name: 'v0.14.2', prerelease: false, draft: false },
      ],
    }
  })

  const { getLatestVersionFromGitHubReleases } = await importFreshAutoUpdater()

  await expect(getLatestVersionFromGitHubReleases('stable')).resolves.toBe(
    '0.14.3',
  )
  expect(calls).toEqual([
    'https://api.github.com/repos/AndersonBY/openclaude/releases?per_page=20',
  ])
})
