export function isTestFile(p: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(tests?|__tests__|e2e|cypress)\//.test(p);
}

export function isToolingConfig(p: string): boolean {
  return !p.includes('/') && /\.config\.[cm]?[jt]s$/.test(p);
}
