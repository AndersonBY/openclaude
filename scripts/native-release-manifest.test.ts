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
    await writeFile(join(dir, 'claude-linux-x64'), 'linux')
    await writeFile(join(dir, 'claude-darwin-x64'), 'mac-intel')
    await writeFile(join(dir, 'claude-darwin-arm64'), 'mac-arm')
    await writeFile(join(dir, 'claude-win32-x64.exe'), 'windows')

    const manifest = await buildNativeReleaseManifest(dir)

    expect(manifest).toEqual({
      platforms: {
        'darwin-arm64': {
          checksum: sha256('mac-arm'),
          asset: 'claude-darwin-arm64',
        },
        'darwin-x64': {
          checksum: sha256('mac-intel'),
          asset: 'claude-darwin-x64',
        },
        'linux-x64': {
          checksum: sha256('linux'),
          asset: 'claude-linux-x64',
        },
        'win32-x64': {
          checksum: sha256('windows'),
          asset: 'claude-win32-x64.exe',
        },
      },
    })
    await expect(readFile(join(dir, 'manifest.json'), 'utf-8')).resolves.toBe(
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
  })

  test('fails before publishing when a common platform asset is missing', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'claude-linux-x64'), 'linux')

    await expect(buildNativeReleaseManifest(dir)).rejects.toThrow(
      'Missing native binaries for platforms: darwin-arm64, darwin-x64, win32-x64',
    )
  })
})
