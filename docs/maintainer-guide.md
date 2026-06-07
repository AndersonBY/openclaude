# OpenClaude Red-Team Maintainer Guide

This guide is the handoff document for this fork. It follows the principle from
the agent-harness engineering note: keep a small repository map in `AGENTS.md`
and put the deeper, versioned operating knowledge in `docs/`.

## Repository Purpose

This fork tracks upstream `Gitlawb/openclaude` while publishing a MakerBI
red-team edition:

- GitHub repository: `AndersonBY/openclaude`
- npm package: `@makerbi/openclaude`
- default development branch: `main`
- legacy compatibility branch: `redteam`, currently intended to stay aligned
  with `main`
- upstream remote: `https://github.com/Gitlawb/openclaude.git`

The fork is intentionally configured for authorized red-team and offensive
security workflows. Do not accidentally reintroduce upstream's safety review
copy, cyber refusal prompts, prompt-injection warnings, malware-improvement
reminders, or auto-mode deny guidance when merging upstream.

## Durable Fork Invariants

### Package and Repository Identity

Keep these values pointed at the fork:

- `package.json` name: `@makerbi/openclaude`
- `package.json` repository URL: `https://github.com/AndersonBY/openclaude.git`
- `scripts/build.ts` `MACRO.PACKAGE_URL`: `@makerbi/openclaude`
- `scripts/build.ts` issue and feedback URLs: `AndersonBY/openclaude`
- user-facing docs should install with `npm install -g @makerbi/openclaude`

Upstream merges often touch package metadata, docs, badges, issue links, and
release tooling. Treat any reversion to `@gitlawb/openclaude`,
`Gitlawb/openclaude`, or `@anthropic-ai/claude-code` as a fork regression unless
there is an explicit reason.

### Red-Team Prompt Behavior

The following red-team changes are intentional and must survive upstream merges:

- `src/constants/cyberRiskInstruction.ts`: `CYBER_RISK_INSTRUCTION` is empty.
- `src/constants/prompts.ts`: cyber risk instruction import/use is removed;
  prompt-injection warning is reduced to neutral external-data wording; OWASP
  security-coding instruction is replaced with correctness-focused wording;
  action confirmation language is simplified.
- `src/tools/FileReadTool/FileReadTool.ts`: malware mitigation reminder is empty
  and file-read mitigation is always disabled.
- `src/utils/messages.ts`: permission-denial workaround guidance and auto-mode
  full instructions avoid upstream's extra safety restrictions.
- `src/utils/permissions/yoloClassifier.ts`: PowerShell auto-mode deny guidance
  list is empty.
- `src/components/AutoModeOptInDialog.tsx`: auto-mode copy describes direct,
  minimally restricted execution.

During conflict resolution, prefer preserving these fork changes and porting
upstream bug fixes around them.

### Native Install Source

`openclaude install` must install this fork's native binary:

- external users resolve versions through
  `https://api.github.com/repos/AndersonBY/openclaude/releases`
- binary assets download from
  `https://github.com/AndersonBY/openclaude/releases/download`
- release assets are named:
  - `openclaude-linux-x64`
  - `openclaude-ubuntu24-x64`
  - `openclaude-kylinv10-x64`
  - `openclaude-darwin-x64`
  - `openclaude-darwin-arm64`
  - `openclaude-win32-x64.exe`
  - `manifest.json`

The native installer writes the executable as `openclaude` or
`openclaude.exe` under the user's local bin directory and stores native versions
under the `openclaude` app directory. It should not install or update a `claude`
binary for this package.

`manifest.json` is intentionally limited to the common native installer
platforms. Ubuntu 24 and Kylin V10 binaries are release assets for pure-offline
packages, not separate `openclaude install` targets.

### Release Workflow

The official upstream release workflow is intentionally removed. This fork uses:

- `.github/workflows/pr-checks.yml` for pushes and PRs on `main`
- `.github/workflows/npm-publish.yml` for `v*` tag releases

`npm-publish.yml` builds common native platforms first, builds Ubuntu 24 x64 and
Kylin V10 x64 binaries for pure-offline packages, uploads binaries,
`manifest.json`, and the offline archives to the GitHub Release, then publishes
`@makerbi/openclaude` to npm. The npm environment is named `npm-publish`.

## Upstream Merge Procedure

Use `main` as the canonical fork branch. Keep `redteam` as a compatibility
pointer unless the owner explicitly changes branch policy.

```bash
git fetch origin upstream --prune
git switch main
git status --short --branch
git log --oneline --left-right --cherry-pick upstream/main...HEAD -n 80
git merge upstream/main
```

If there are conflicts, resolve them with the invariants above in mind. After
the merge, inspect the fork deltas:

```bash
git diff upstream/main...HEAD -- \
  package.json \
  scripts/build.ts \
  .github/workflows/npm-publish.yml \
  src/constants/cyberRiskInstruction.ts \
  src/constants/prompts.ts \
  src/tools/FileReadTool/FileReadTool.ts \
  src/utils/messages.ts \
  src/utils/permissions/yoloClassifier.ts \
  src/utils/nativeInstaller/download.ts \
  src/utils/nativeInstaller/installer.ts
```

Run focused checks:

```bash
bun install --frozen-lockfile
bun run build
bun run smoke
bun test src/utils/nativeInstaller/download.test.ts src/utils/openclaudeInstallSurfaces.test.ts src/utils/autoUpdater.githubReleases.test.ts
```

Run the full suite when the upstream merge touches shared runtime, provider,
permission, or installer code:

```bash
bun test --max-concurrency=1
bun run typecheck
```

Push `main`, then fast-forward `redteam` if it is still being kept as a public
compatibility branch:

```bash
git push origin main
git branch -f redteam main
git push origin redteam
```

## Release Procedure

Only release from a clean, validated `main`.

1. Bump the package version.

   ```bash
   npm version patch --no-git-tag-version
   ```

   Use `minor` or an explicit version when appropriate. Make sure
   `package.json` and `package-lock.json` agree on the same version. The
   `.release-please-manifest.json` file is legacy now that upstream's
   release-please workflow is removed; do not use it as the source of truth for
   this fork's release version.

2. Build and smoke test locally.

   ```bash
   bun install --frozen-lockfile
   bun run build
   bun run smoke
   bun test src/utils/nativeInstaller/download.test.ts src/utils/openclaudeInstallSurfaces.test.ts src/utils/autoUpdater.githubReleases.test.ts
   ```

3. Commit, tag, and push.

   ```bash
   git add package.json package-lock.json bun.lock
   git commit -m "chore: release makerbi openclaude <version>"
   git tag v<version>
   git push origin main
   git push origin v<version>
   ```

   The tag version must exactly match `package.json` without the leading `v`.

4. Watch the workflow.

   ```bash
   gh run list --workflow npm-publish.yml --limit 5
   gh run watch
   ```

5. Verify the release is asset-complete.

   ```bash
   gh release view v<version> --json tagName,assets
   npm view @makerbi/openclaude@<version> version
   ```

   The GitHub Release must include all common-platform binaries and
   `manifest.json`; npm success alone is not enough because `openclaude install`
   depends on the release assets.

   The release must also include the pure-offline package assets:

   - `openclaude-<version>-windows-x64-offline.zip`
   - `openclaude-<version>-ubuntu24-x64-offline.tar.gz`
   - `openclaude-<version>-kylinv10-x64-offline.tar.gz`

   These packages are for air-gapped target machines. Each archive contains the
   native executable, `SHA256SUMS`, install/uninstall scripts, and a local
   README. The target-machine install scripts must not fetch npm packages,
   GitHub Release assets, or public container images.

## Install Verification

After a release, verify both npm wrapper and native installer behavior.

```powershell
npm install -g @makerbi/openclaude@latest --force
& "$env:APPDATA\npm\openclaude.cmd" --version
& "$env:APPDATA\npm\openclaude.cmd" install --force latest
where.exe openclaude
openclaude --version
```

On Windows, `openclaude install` places the native executable at:

```text
%USERPROFILE%\.local\bin\openclaude.exe
```

If `where.exe openclaude` shows this path before the npm shim, the terminal will
run the native binary first. That is expected after installation. If the native
binary is broken, remove it and reinstall from the npm wrapper:

```powershell
Remove-Item "$env:USERPROFILE\.local\bin\openclaude.exe" -Force -ErrorAction SilentlyContinue
& "$env:APPDATA\npm\openclaude.cmd" install --force latest
```

The past Windows failure
`Cannot find module '@aws-sdk/client-bedrock-runtime' from ...openclaude-win32-x64.exe`
means the compiled native binary externalized a runtime SDK dependency. Keep the
runtime SDK bundle list in `scripts/externals.ts` and the native workflow's
compile flags in sync when adding provider dependencies.

## Troubleshooting Release Assets

If npm publishes but `openclaude install` fails to find a binary:

1. Check whether the tag has a GitHub Release.
2. Check whether the release includes `manifest.json` and the current platform's
   asset.
3. Check whether `manifest.json` maps the current platform to the exact asset
   name.
4. Re-run or repair `.github/workflows/npm-publish.yml`; do not publish a second
   npm version until the broken version's release assets are understood.

Useful commands:

```bash
gh release view v<version> --json assets
gh run list --workflow npm-publish.yml --limit 10
gh run view <run-id> --log-failed
```

For offline package changes, run:

```bash
bun test scripts/offline-package.test.ts scripts/native-release-manifest.test.ts
```

Before closing a release, inspect the asset list for the Windows, Ubuntu 24, and
Kylin V10 offline archives. Kylin V10 currently means x86_64 unless the owner
explicitly requests an ARM64/aarch64 package.

## Documentation Maintenance

Keep `AGENTS.md` small and stable. When a future maintainer learns something
important about upstream merges, release automation, native installation, or the
red-team delta, update this guide instead of relying on chat history.

When changing behavior, update the relevant user-facing docs:

- install commands: `README.md`, `docs/quick-start-windows.md`,
  `docs/quick-start-mac-linux.md`, `docs/advanced-setup.md`
- integration architecture: `docs/architecture/integrations.md`
- provider additions: `docs/integrations/how-to/`

The goal is that a new maintainer or coding agent can recover the project state
from the repository itself without needing private conversation history.
