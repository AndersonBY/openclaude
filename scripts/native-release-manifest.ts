import { createHash } from 'crypto'
import { readdir, readFile, writeFile } from 'fs/promises'
import { basename, join } from 'path'

const PLATFORM_ASSET_RE = /^claude-(linux-x64|darwin-x64|darwin-arm64|win32-x64\.exe)$/

function platformFromAssetName(assetName: string): string | null {
  const match = assetName.match(PLATFORM_ASSET_RE)
  if (!match) return null
  return match[1]!.replace(/\.exe$/, '')
}

export async function buildNativeReleaseManifest(
  binariesDir: string,
  manifestPath = join(binariesDir, 'manifest.json'),
) {
  const entries = await readdir(binariesDir)
  const platforms: Record<string, { checksum: string; asset: string }> = {}

  for (const entry of entries.sort()) {
    const platform = platformFromAssetName(entry)
    if (!platform) continue

    const assetPath = join(binariesDir, entry)
    const data = await readFile(assetPath)
    platforms[platform] = {
      checksum: createHash('sha256').update(data).digest('hex'),
      asset: basename(entry),
    }
  }

  const expectedPlatforms = [
    'darwin-arm64',
    'darwin-x64',
    'linux-x64',
    'win32-x64',
  ]
  const missingPlatforms = expectedPlatforms.filter(
    platform => !platforms[platform],
  )

  if (missingPlatforms.length > 0) {
    throw new Error(
      `Missing native binaries for platforms: ${missingPlatforms.join(', ')}`,
    )
  }

  const manifest = {
    platforms,
  }

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

if (import.meta.main) {
  const binariesDir = process.argv[2] ?? 'native-dist'
  await buildNativeReleaseManifest(binariesDir)
}
