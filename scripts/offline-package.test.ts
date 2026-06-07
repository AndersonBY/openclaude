import { afterEach, describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { gunzipSync, unzipSync } from 'fflate'
import {
  OFFLINE_PACKAGE_TARGETS,
  buildOfflineReleasePackages,
} from './offline-package'

const tempDirs: string[] = []

async function makeTempDir() {
  const dir = await mkdtemp(join(tmpdir(), 'openclaude-offline-package-'))
  tempDirs.push(dir)
  return dir
}

async function writeFakeNativeBinaries(dir: string) {
  await writeFile(join(dir, 'openclaude-win32-x64.exe'), 'windows-binary')
  await writeFile(join(dir, 'openclaude-ubuntu24-x64'), 'ubuntu-binary')
  await writeFile(join(dir, 'openclaude-kylinv10-x64'), 'kylin-binary')
}

function sha256(value: string) {
  return createHash('sha256').update(Buffer.from(value)).digest('hex')
}

function listTarGzEntries(archive: Uint8Array): string[] {
  return Object.keys(readTarGzEntries(archive))
}

function readTarGzEntries(archive: Uint8Array): Record<string, Buffer> {
  const tar = Buffer.from(gunzipSync(archive))
  const entries: Record<string, Buffer> = {}
  let offset = 0

  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512)
    if (header.every(byte => byte === 0)) break

    const name = header
      .subarray(0, 100)
      .toString('utf8')
      .replace(/\0.*$/, '')
    const sizeText = header
      .subarray(124, 136)
      .toString('utf8')
      .replace(/\0.*$/, '')
      .trim()
    const size = Number.parseInt(sizeText || '0', 8)

    const dataStart = offset + 512
    entries[name] = tar.subarray(dataStart, dataStart + size)
    offset = dataStart + Math.ceil(size / 512) * 512
  }

  return entries
}

describe('offline release packages', () => {
  test('defines the three pure-offline release targets', () => {
    expect(OFFLINE_PACKAGE_TARGETS.map(target => target.id)).toEqual([
      'windows-x64',
      'ubuntu24-x64',
      'kylinv10-x64',
    ])
    expect(OFFLINE_PACKAGE_TARGETS.map(target => target.archiveExt)).toEqual([
      '.zip',
      '.tar.gz',
      '.tar.gz',
    ])
  })

  test('builds Windows, Ubuntu 24, and Kylin V10 offline archives with local install scripts', async () => {
    const dir = await makeTempDir()
    await writeFakeNativeBinaries(dir)

    const packages = await buildOfflineReleasePackages({
      nativeDistDir: dir,
      version: '0.18.0',
    })

    expect(packages.map(pkg => pkg.assetName)).toEqual([
      'openclaude-0.18.0-windows-x64-offline.zip',
      'openclaude-0.18.0-ubuntu24-x64-offline.tar.gz',
      'openclaude-0.18.0-kylinv10-x64-offline.tar.gz',
    ])

    const windowsZip = await readFile(join(dir, packages[0]!.assetName))
    const windowsEntries = unzipSync(windowsZip)
    expect(Object.keys(windowsEntries).sort()).toEqual([
      'openclaude-0.18.0-windows-x64-offline/README.md',
      'openclaude-0.18.0-windows-x64-offline/SHA256SUMS',
      'openclaude-0.18.0-windows-x64-offline/bin/openclaude.exe',
      'openclaude-0.18.0-windows-x64-offline/install.ps1',
      'openclaude-0.18.0-windows-x64-offline/uninstall.ps1',
    ])
    expect(
      Buffer.from(
        windowsEntries[
          'openclaude-0.18.0-windows-x64-offline/SHA256SUMS'
        ]!,
      ).toString('utf8'),
    ).toContain(`${sha256('windows-binary')}  bin/openclaude.exe`)
    expect(
      Buffer.from(
        windowsEntries[
          'openclaude-0.18.0-windows-x64-offline/install.ps1'
        ]!,
      ).toString('utf8'),
    ).toContain('openclaude.cmd')
    expect(
      Buffer.from(
        windowsEntries[
          'openclaude-0.18.0-windows-x64-offline/install.ps1'
        ]!,
      ).toString('utf8'),
    ).toContain('DISABLE_AUTOUPDATER')

    const ubuntuTar = await readFile(join(dir, packages[1]!.assetName))
    const ubuntuEntries = readTarGzEntries(ubuntuTar)
    expect(Object.keys(ubuntuEntries)).toEqual([
      'openclaude-0.18.0-ubuntu24-x64-offline/README.md',
      'openclaude-0.18.0-ubuntu24-x64-offline/SHA256SUMS',
      'openclaude-0.18.0-ubuntu24-x64-offline/bin/openclaude',
      'openclaude-0.18.0-ubuntu24-x64-offline/install.sh',
      'openclaude-0.18.0-ubuntu24-x64-offline/uninstall.sh',
    ])
    const ubuntuInstallScript =
      ubuntuEntries[
        'openclaude-0.18.0-ubuntu24-x64-offline/install.sh'
      ]!.toString('utf8')
    expect(ubuntuInstallScript).toContain('DISABLE_AUTOUPDATER')
    expect(ubuntuInstallScript).not.toContain('python3')

    const kylinTar = await readFile(join(dir, packages[2]!.assetName))
    const kylinEntries = readTarGzEntries(kylinTar)
    expect(Object.keys(kylinEntries)).toEqual([
      'openclaude-0.18.0-kylinv10-x64-offline/README.md',
      'openclaude-0.18.0-kylinv10-x64-offline/SHA256SUMS',
      'openclaude-0.18.0-kylinv10-x64-offline/bin/openclaude',
      'openclaude-0.18.0-kylinv10-x64-offline/install.sh',
      'openclaude-0.18.0-kylinv10-x64-offline/uninstall.sh',
    ])
  })

  test('fails before publishing when an offline binary is missing', async () => {
    const dir = await makeTempDir()
    await writeFile(join(dir, 'openclaude-win32-x64.exe'), 'windows-binary')

    await expect(
      buildOfflineReleasePackages({
        nativeDistDir: dir,
        version: '0.18.0',
      }),
    ).rejects.toThrow('Missing offline binary assets: openclaude-ubuntu24-x64, openclaude-kylinv10-x64')
  })

  test('release workflow uploads offline archives together with native binaries', async () => {
    const workflow = await readFile(
      join(import.meta.dir, '..', '.github', 'workflows', 'npm-publish.yml'),
      'utf-8',
    )

    expect(workflow).toContain('Build native Ubuntu 24 x64')
    expect(workflow).toContain('Build native Kylin V10 x64')
    expect(workflow).toContain('hxsoong/kylin:v10-sp1')
    expect(workflow).toContain('workflow_dispatch')
    expect(workflow).toContain('release_tag')
    expect(workflow).toContain('inputs.release_tag')
    expect(workflow).toContain('bun run scripts/offline-package.ts native-dist "$RELEASE_TAG"')
    expect(workflow).toContain("if: github.event_name == 'push' || inputs.publish_npm == 'true'")
    expect(workflow).toContain('openclaude-*-windows-x64-offline.zip')
    expect(workflow).toContain('openclaude-*-ubuntu24-x64-offline.tar.gz')
    expect(workflow).toContain('openclaude-*-kylinv10-x64-offline.tar.gz')
  })
})

afterEach(async () => {
  await Promise.all(
    tempDirs.map(dir => rm(dir, { recursive: true, force: true })),
  )
  tempDirs.length = 0
})
