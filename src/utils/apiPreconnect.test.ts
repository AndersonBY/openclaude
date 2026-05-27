import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

const originalEnv = { ...process.env }
const originalFetch = globalThis.fetch

async function importFreshModule() {
  mock.restore()
  return import(`./apiPreconnect.ts?ts=${Date.now()}-${Math.random()}`)
}

beforeEach(async () => {
  await acquireSharedMutationLock('utils/apiPreconnect.test.ts')
  process.env = { ...originalEnv }
})

afterEach(() => {
  try {
    process.env = { ...originalEnv }
    globalThis.fetch = originalFetch
    mock.restore()
  } finally {
    releaseSharedMutationLock()
  }
})

describe('preconnectAnthropicApi', () => {
  test('does not reuse a stale first-party provider module mock', async () => {
    const result = spawnSync(
      process.execPath,
      [
        '--eval',
        `
          import { mock } from 'bun:test'

          process.env.CLAUDE_CODE_USE_OPENAI = '1'
          mock.module('./src/utils/model/providers.js', () => ({
            getAPIProvider: () => 'firstParty',
            getAPIProviderForStatsig: () => 'firstParty',
            usesAnthropicAccountFlow: () => true,
            isGithubNativeAnthropicMode: () => false,
            isFirstPartyAnthropicBaseUrl: () => true,
          }))
          await import('./src/utils/model/providers.js')
          mock.restore()

          let calls = 0
          globalThis.fetch = () => {
            calls += 1
            return Promise.resolve(new Response(null, { status: 200 }))
          }
          const { preconnectAnthropicApi } = await import(
            \`./src/utils/apiPreconnect.ts?child=\${Date.now()}\`
          )
          preconnectAnthropicApi()

          if (calls !== 0) {
            throw new Error(\`expected no fetch, received \${calls}\`)
          }
        `,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )

    if (result.status !== 0) {
      throw new Error(
        `child process failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      )
    }
  })

  test('does not fetch when OpenAI mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_OPENAI = '1'
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not fetch when Gemini mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_GEMINI = '1'
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('does not fetch when GitHub mode is enabled', async () => {
    process.env.CLAUDE_CODE_USE_GITHUB = '1'
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('fetches in first-party mode', async () => {
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GITHUB
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.HTTPS_PROXY
    delete process.env.https_proxy
    delete process.env.HTTP_PROXY
    delete process.env.http_proxy
    delete process.env.ANTHROPIC_UNIX_SOCKET
    delete process.env.CLAUDE_CODE_CLIENT_CERT
    delete process.env.CLAUDE_CODE_CLIENT_KEY

    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 200 })))
    globalThis.fetch = fetchMock as typeof globalThis.fetch

    const { preconnectAnthropicApi } = await importFreshModule()
    preconnectAnthropicApi()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
