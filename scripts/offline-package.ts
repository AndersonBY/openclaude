import { createHash } from 'crypto'
import { readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { gzipSync, zipSync } from 'fflate'

export type OfflinePackageTarget = {
  id: 'windows-x64' | 'ubuntu24-x64' | 'kylinv10-x64'
  label: string
  sourceAsset: string
  executableName: string
  archiveExt: '.zip' | '.tar.gz'
  scriptKind: 'powershell' | 'shell'
}

export const OFFLINE_PACKAGE_TARGETS: OfflinePackageTarget[] = [
  {
    id: 'windows-x64',
    label: 'Windows x64',
    sourceAsset: 'openclaude-win32-x64.exe',
    executableName: 'openclaude.exe',
    archiveExt: '.zip',
    scriptKind: 'powershell',
  },
  {
    id: 'ubuntu24-x64',
    label: 'Ubuntu 24.04 x64',
    sourceAsset: 'openclaude-ubuntu24-x64',
    executableName: 'openclaude',
    archiveExt: '.tar.gz',
    scriptKind: 'shell',
  },
  {
    id: 'kylinv10-x64',
    label: 'Kylin V10 x64',
    sourceAsset: 'openclaude-kylinv10-x64',
    executableName: 'openclaude',
    archiveExt: '.tar.gz',
    scriptKind: 'shell',
  },
]

export type BuildOfflineReleasePackagesOptions = {
  nativeDistDir: string
  version: string
}

export type OfflineReleasePackage = {
  target: OfflinePackageTarget
  assetName: string
  assetPath: string
}

function normalizeVersion(version: string) {
  return version.startsWith('v') ? version.slice(1) : version
}

function sha256(data: Buffer) {
  return createHash('sha256').update(data).digest('hex')
}

function renderReadme(target: OfflinePackageTarget, version: string) {
  if (target.scriptKind === 'powershell') {
    return `# OpenClaude ${version} ${target.label} Offline Package

This package installs OpenClaude without downloading npm packages or GitHub
Release assets on the target machine.

## Install

\`\`\`powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\\install.ps1
openclaude --version
\`\`\`

The installer copies \`bin\\openclaude.exe\` to
\`%LOCALAPPDATA%\\OpenClaude\\offline\\openclaude.exe\`, writes an
\`openclaude.cmd\` launcher under \`%USERPROFILE%\\.local\\bin\`, and adds that
launcher directory to the current user's PATH when needed. The launcher sets
\`DISABLE_AUTOUPDATER=1\` before starting OpenClaude.

## Uninstall

\`\`\`powershell
.\\uninstall.ps1
\`\`\`
`
  }

  return `# OpenClaude ${version} ${target.label} Offline Package

This package installs OpenClaude without downloading npm packages or GitHub
Release assets on the target machine.

## Install

\`\`\`bash
chmod +x install.sh uninstall.sh
./install.sh
openclaude --version
\`\`\`

The installer copies \`bin/openclaude\` to
\`$HOME/.local/share/openclaude/offline/openclaude\`, writes an \`openclaude\`
launcher under \`$HOME/.local/bin\`, and prints a PATH export line when needed.
The launcher sets \`DISABLE_AUTOUPDATER=1\` before starting OpenClaude.

## Uninstall

\`\`\`bash
./uninstall.sh
\`\`\`
`
}

function renderWindowsInstallScript(version: string) {
  return `$ErrorActionPreference = "Stop"

$LauncherDir = Join-Path $env:USERPROFILE ".local\\bin"
$InstallDir = Join-Path $env:LOCALAPPDATA "OpenClaude\\offline"
$Source = Join-Path $PSScriptRoot "bin\\openclaude.exe"
$Target = Join-Path $InstallDir "openclaude.exe"
$Launcher = Join-Path $LauncherDir "openclaude.cmd"
$ExpectedHash = ((Get-Content -LiteralPath (Join-Path $PSScriptRoot "SHA256SUMS") -Raw) -split "\\s+")[0]
$ActualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Source).Hash.ToLowerInvariant()
if ($ActualHash -ne $ExpectedHash) {
  throw "Checksum mismatch for $Source. Expected $ExpectedHash, got $ActualHash."
}

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $LauncherDir | Out-Null
Copy-Item -LiteralPath $Source -Destination $Target -Force

$pathParts = [Environment]::GetEnvironmentVariable("Path", "User") -split ";"
if ($pathParts -notcontains $LauncherDir) {
  $newPath = (@($pathParts | Where-Object { $_ }) + $LauncherDir) -join ";"
  [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
  $env:Path = "$env:Path;$LauncherDir"
}

@"
@echo off
set DISABLE_AUTOUPDATER=1
"$Target" %*
"@ | Set-Content -LiteralPath $Launcher -Encoding ASCII

Write-Host "OpenClaude ${version} installed to $Target"
Write-Host "Launcher written to $Launcher"
Write-Host "Restart the terminal if openclaude is not found on PATH."
`
}

function renderWindowsUninstallScript() {
  return `$ErrorActionPreference = "Stop"

$Target = Join-Path $env:LOCALAPPDATA "OpenClaude\\offline\\openclaude.exe"
$Launcher = Join-Path $env:USERPROFILE ".local\\bin\\openclaude.cmd"
if (Test-Path -LiteralPath $Launcher) {
  Remove-Item -LiteralPath $Launcher -Force
  Write-Host "Removed $Launcher"
}
if (Test-Path -LiteralPath $Target) {
  Remove-Item -LiteralPath $Target -Force
  Write-Host "Removed $Target"
} else {
  Write-Host "OpenClaude executable was not found at $Target"
}
`
}

function renderShellInstallScript(version: string) {
  return `#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCHER_DIR="$HOME/.local/bin"
INSTALL_DIR="$HOME/.local/share/openclaude/offline"
SOURCE="$SCRIPT_DIR/bin/openclaude"
TARGET="$INSTALL_DIR/openclaude"
LAUNCHER="$LAUNCHER_DIR/openclaude"

if command -v sha256sum >/dev/null 2>&1; then
  (cd "$SCRIPT_DIR" && sha256sum -c SHA256SUMS)
else
  echo "sha256sum is required to verify the offline package." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR" "$LAUNCHER_DIR"
install -m 0755 "$SOURCE" "$TARGET"

cat > "$LAUNCHER" <<EOF
#!/usr/bin/env bash
export DISABLE_AUTOUPDATER=1
exec "$TARGET" "\\$@"
EOF
chmod 0755 "$LAUNCHER"

case ":$PATH:" in
  *":$LAUNCHER_DIR:"*) ;;
  *)
    echo "Add this line to your shell profile if openclaude is not found:"
    echo "export PATH=\\"\\$HOME/.local/bin:\\$PATH\\""
    ;;
esac

echo "OpenClaude ${version} installed to $TARGET"
echo "Launcher written to $LAUNCHER"
`
}

function renderShellUninstallScript() {
  return `#!/usr/bin/env bash
set -euo pipefail

TARGET="$HOME/.local/share/openclaude/offline/openclaude"
LAUNCHER="$HOME/.local/bin/openclaude"
if [ -f "$LAUNCHER" ]; then
  rm -f "$LAUNCHER"
  echo "Removed $LAUNCHER"
fi
if [ -f "$TARGET" ]; then
  rm -f "$TARGET"
  echo "Removed $TARGET"
else
  echo "OpenClaude executable was not found at $TARGET"
fi
`
}

function alignTarSize(size: number) {
  return Math.ceil(size / 512) * 512
}

function makeTarHeader(name: string, data: Buffer, mode: number) {
  const header = Buffer.alloc(512, 0)
  header.write(name, 0, 100, 'utf8')
  header.write(mode.toString(8).padStart(7, '0') + '\0', 100, 8, 'ascii')
  header.write('0000000\0', 108, 8, 'ascii')
  header.write('0000000\0', 116, 8, 'ascii')
  header.write(data.length.toString(8).padStart(11, '0') + '\0', 124, 12, 'ascii')
  header.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0', 136, 12, 'ascii')
  header.fill(0x20, 148, 156)
  header.write('0', 156, 1, 'ascii')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')

  let checksum = 0
  for (const byte of header) {
    checksum += byte
  }
  header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
  return header
}

function createTarGz(files: { path: string; data: Buffer; mode: number }[]) {
  const chunks: Buffer[] = []
  for (const file of files) {
    chunks.push(makeTarHeader(file.path, file.data, file.mode))
    chunks.push(file.data)
    const padding = alignTarSize(file.data.length) - file.data.length
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding, 0))
    }
  }
  chunks.push(Buffer.alloc(1024, 0))
  return Buffer.from(gzipSync(Buffer.concat(chunks)))
}

async function createZipArchive(
  files: { path: string; data: Buffer }[],
  outputPath: string,
) {
  const zipInput: Record<string, Uint8Array> = {}
  for (const file of files) {
    zipInput[file.path] = file.data
  }
  await writeFile(outputPath, Buffer.from(zipSync(zipInput)))
}

async function createTarGzArchive(
  files: { path: string; data: Buffer; mode: number }[],
  outputPath: string,
) {
  await writeFile(outputPath, createTarGz(files))
}

async function packageTarget(
  target: OfflinePackageTarget,
  nativeDistDir: string,
  version: string,
): Promise<OfflineReleasePackage> {
  const sourcePath = join(nativeDistDir, target.sourceAsset)
  const binary = await readFile(sourcePath)
  const packageDirName = `openclaude-${version}-${target.id}-offline`
  const assetName = `${packageDirName}${target.archiveExt}`
  const assetPath = join(nativeDistDir, assetName)
  const binaryPath = `bin/${target.executableName}`
  const checksum = `${sha256(binary)}  ${binaryPath}\n`
  const readme = renderReadme(target, version)

  if (target.scriptKind === 'powershell') {
    await createZipArchive(
      [
        {
          path: `${packageDirName}/README.md`,
          data: Buffer.from(readme),
        },
        {
          path: `${packageDirName}/SHA256SUMS`,
          data: Buffer.from(checksum),
        },
        {
          path: `${packageDirName}/bin/${target.executableName}`,
          data: binary,
        },
        {
          path: `${packageDirName}/install.ps1`,
          data: Buffer.from(renderWindowsInstallScript(version)),
        },
        {
          path: `${packageDirName}/uninstall.ps1`,
          data: Buffer.from(renderWindowsUninstallScript()),
        },
      ],
      assetPath,
    )
  } else {
    await createTarGzArchive(
      [
        {
          path: `${packageDirName}/README.md`,
          data: Buffer.from(readme),
          mode: 0o644,
        },
        {
          path: `${packageDirName}/SHA256SUMS`,
          data: Buffer.from(checksum),
          mode: 0o644,
        },
        {
          path: `${packageDirName}/bin/${target.executableName}`,
          data: binary,
          mode: 0o755,
        },
        {
          path: `${packageDirName}/install.sh`,
          data: Buffer.from(renderShellInstallScript(version)),
          mode: 0o755,
        },
        {
          path: `${packageDirName}/uninstall.sh`,
          data: Buffer.from(renderShellUninstallScript()),
          mode: 0o755,
        },
      ],
      assetPath,
    )
  }

  return {
    target,
    assetName,
    assetPath,
  }
}

export async function buildOfflineReleasePackages(
  options: BuildOfflineReleasePackagesOptions,
): Promise<OfflineReleasePackage[]> {
  const version = normalizeVersion(options.version)
  const missingAssets: string[] = []

  for (const target of OFFLINE_PACKAGE_TARGETS) {
    try {
      await readFile(join(options.nativeDistDir, target.sourceAsset))
    } catch {
      missingAssets.push(target.sourceAsset)
    }
  }

  if (missingAssets.length > 0) {
    throw new Error(`Missing offline binary assets: ${missingAssets.join(', ')}`)
  }

  const packages: OfflineReleasePackage[] = []
  for (const target of OFFLINE_PACKAGE_TARGETS) {
    packages.push(await packageTarget(target, options.nativeDistDir, version))
  }

  return packages
}

async function main() {
  const nativeDistDir = process.argv[2] ?? 'native-dist'
  const version =
    process.argv[3] ??
    process.env.GITHUB_REF_NAME?.replace(/^v/, '') ??
    process.env.npm_package_version

  if (!version) {
    throw new Error(
      'Version is required. Usage: bun run scripts/offline-package.ts <native-dist> <version>',
    )
  }

  const packages = await buildOfflineReleasePackages({
    nativeDistDir,
    version,
  })

  for (const pkg of packages) {
    console.log(pkg.assetName)
  }
}

if (import.meta.main) {
  await main()
}
