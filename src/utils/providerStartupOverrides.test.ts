import { describe, expect, mock, test } from 'bun:test'

async function importProviderStartupOverrides() {
  return (await import(
    `./providerStartupOverrides.ts?actual=${Date.now()}-${Math.random()}`
  )) as typeof import('./providerStartupOverrides.js')
}

type ClearStartupProviderOverrides =
  typeof import('./providerStartupOverrides.js').clearStartupProviderOverrides
type ClearStartupProviderOverridesOptions = NonNullable<
  Parameters<ClearStartupProviderOverrides>[0]
>
type UpdateUserSettings = NonNullable<
  ClearStartupProviderOverridesOptions['updateUserSettings']
>
type SaveConfig = NonNullable<
  ClearStartupProviderOverridesOptions['saveConfig']
>

describe('clearStartupProviderOverrides', () => {
  test('removes stale provider env from user settings and global config env', async () => {
    mock.restore()
    const { clearStartupProviderOverrides } =
      await importProviderStartupOverrides()
    let updateUserSettingsCall:
      | [string, { env?: Record<string, string | undefined> }]
      | undefined
    let savedConfig: { env: Record<string, string> } | undefined
    const updateUserSettings: UpdateUserSettings = (source, settings) => {
      updateUserSettingsCall = [
        source,
        settings as { env?: Record<string, string | undefined> },
      ]
      return { error: null }
    }
    const saveConfig: SaveConfig = updater => {
      const updated = updater({
        env: {
          CLAUDE_CODE_USE_OPENAI: '1',
          OPENAI_BASE_URL: 'https://api.minimax.io/v1',
          OPENAI_MODEL: 'minimax-m2.7',
          OPENAI_API_KEYS: 'pool-a,pool-b',
          OPENAI_API_KEY: 'single-key',
          MINIMAX_API_KEY: 'sk-minimax',
          VENICE_API_KEY: 'sk-venice',
          KEEP_ME: '1',
        },
      })
      savedConfig = { env: updated.env ?? {} }
      return savedConfig
    }

    const error = clearStartupProviderOverrides({
      updateUserSettings,
      saveConfig,
    })

    expect(error).toBeNull()
    expect(updateUserSettingsCall).toEqual([
      'userSettings',
      expect.objectContaining({
        env: expect.objectContaining({
          CLAUDE_CODE_USE_OPENAI: undefined,
          OPENAI_BASE_URL: undefined,
          OPENAI_MODEL: undefined,
          OPENAI_API_KEYS: undefined,
          OPENAI_API_KEY: undefined,
          MINIMAX_API_KEY: undefined,
          VENICE_API_KEY: undefined,
        }),
      }),
    ])
    expect(savedConfig?.env).toEqual({ KEEP_ME: '1' })
  })
})
