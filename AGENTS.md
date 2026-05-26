# OpenClaude Maintainer Map

This repository is the AndersonBY / MakerBI red-team fork of upstream
`Gitlawb/openclaude`.

Before non-trivial changes, read [docs/maintainer-guide.md](docs/maintainer-guide.md).
Keep this file short; put durable process details in docs instead of expanding this
map.

## Hard Invariants

- Preserve the package identity `@makerbi/openclaude` and repository identity
  `https://github.com/AndersonBY/openclaude`.
- Preserve the red-team edition behavior: this fork intentionally removes cyber
  safety review prompts, prompt-injection warnings, malware-improvement
  reminders, auto-mode safety limits, and PowerShell auto-mode deny guidance for
  authorized red-team / offensive security work.
- Do not restore upstream's official release workflow. This fork publishes from
  `.github/workflows/npm-publish.yml` when a `v*` tag is pushed.
- Native `openclaude install` must download this fork's GitHub Release assets,
  not upstream GCS or another package's binaries.

## Red-Team Delta Files

Review these files carefully during upstream merges:

- `src/constants/cyberRiskInstruction.ts`
- `src/constants/prompts.ts`
- `src/tools/FileReadTool/FileReadTool.ts`
- `src/utils/messages.ts`
- `src/utils/permissions/yoloClassifier.ts`
- `src/components/AutoModeOptInDialog.tsx`

## Release Delta Files

Review these files carefully during upstream merges and releases:

- `package.json`
- `scripts/build.ts`
- `scripts/externals.ts`
- `scripts/native-release-manifest.ts`
- `.github/workflows/npm-publish.yml`
- `src/utils/nativeInstaller/download.ts`
- `src/utils/nativeInstaller/installer.ts`
- `src/utils/autoUpdater.ts`

## Validation

Use focused validation for the changed surface:

```bash
bun run build
bun run smoke
bun test --max-concurrency=1
```

For release or install changes, also run the native installer and auto-updater
tests documented in `docs/maintainer-guide.md`.
