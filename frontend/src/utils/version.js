// The label the UI puts next to the version (app bar chip, status bar):
// "Beta" for a -beta.N build, "Pre-release" for any other suffix (-rc.1),
// and nothing for a release (0.9.0) or a dev build with no version.

export function prereleaseLabel(version) {
  const suffix = String(version || '').split('+')[0].split('-').slice(1).join('-')
  if (!suffix) return ''
  return /^beta\b/i.test(suffix) ? 'Beta' : 'Pre-release'
}
