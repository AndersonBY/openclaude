import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createHash } from 'crypto'
import { buildNativeReleaseManifest } from './native-release-manifest'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(
    tempDirs.map(dir => rm(dir, { recursive: true, force: true })),
  )
  tempDirs.length = 0
})

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-native-manifest-'))
  tempDirs.push(dir)
  return dir
}

function sha256(value: string) {
  return createHash('sha256').update(Buffer.from(value)).digest('hex')
}

describe('native release manifest', () => {
  test('maps common platform binary assets to checksummed installer manifest entries', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'openclaude-linux-x64'), 'linux')
    await writeFile(join(dir, 'openclaude-darwin-x64'), 'mac-intel')
    await writeFile(join(dir, 'openclaude-darwin-arm64'), 'mac-arm')
    await writeFile(join(dir, 'openclaude-win32-x64.exe'), 'windows')
    await writeFile(join(dir, 'openclaude-ubuntu24-x64'), 'ubuntu')
    await writeFile(join(dir, 'openclaude-kylinv10-x64'), 'kylin')

    const manifest = await buildNativeReleaseManifest(dir)

    expect(manifest).toEqual({
      platforms: {
        'darwin-arm64': {
          checksum: sha256('mac-arm'),
          asset: 'openclaude-darwin-arm64',
        },
        'darwin-x64': {
          checksum: sha256('mac-intel'),
          asset: 'openclaude-darwin-x64',
        },
        'linux-x64': {
          checksum: sha256('linux'),
          asset: 'openclaude-linux-x64',
        },
        'win32-x64': {
          checksum: sha256('windows'),
          asset: 'openclaude-win32-x64.exe',
        },
      },
    })
    await expect(readFile(join(dir, 'manifest.json'), 'utf-8')).resolves.toBe(
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
  })

  test('fails before publishing when a common platform asset is missing', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'openclaude-linux-x64'), 'linux')

    await expect(buildNativeReleaseManifest(dir)).rejects.toThrow(
      'Missing native binaries for platforms: darwin-arm64, darwin-x64, win32-x64',
    )
  })
})

describe('native release workflow', () => {
  test('does not externalize runtime SDK dependencies from standalone binaries', async () => {
    const workflow = await readFile(
      join(import.meta.dir, '..', '.github', 'workflows', 'npm-publish.yml'),
      'utf-8',
    )

    for (const dependency of [
      '@aws-sdk/client-bedrock',
      '@aws-sdk/client-bedrock-runtime',
      '@aws-sdk/client-sts',
      '@aws-sdk/credential-providers',
      '@aws-sdk/credential-provider-node',
      '@smithy/node-http-handler',
      '@smithy/core',
      '@azure/identity',
      'google-auth-library',
      '@orama/orama',
      '@orama/plugin-data-persistence',
    ]) {
      expect(workflow).not.toContain(`--external=${dependency}`)
    }
  })
})
