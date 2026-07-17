/**
 * True when this build ships its own native binary distribution, i.e. the
 * build-time package has a supported native release source.
 *
 * MakerBI OpenClaude uses GitHub Release assets instead of an npm native
 * package, so it intentionally has no `NATIVE_PACKAGE_URL`. Other custom npm
 * builds stay gated unless they explicitly provide a native package URL.
 *
 * Bun's `define` inlines these member expressions so unsupported branches can
 * still be removed by dead-code elimination.
 */
export function hasNativeDistribution(): boolean {
  return (
    MACRO.PACKAGE_URL === '@makerbi/openclaude' ||
    MACRO.NATIVE_PACKAGE_URL !== undefined
  )
}
