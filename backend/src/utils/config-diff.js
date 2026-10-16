const Diff = require('diff');

/**
 * Unified diff of two configuration texts, with line counts.
 * Shared by device backups and cloud-scope backups.
 * @returns {{ patch: string, additions: number, deletions: number }}
 */
function unifiedDiff(fromLabel, toLabel, fromText, toText) {
  const patch = Diff.createTwoFilesPatch(fromLabel, toLabel, fromText, toText);

  let additions = 0;
  let deletions = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }
  return { patch, additions, deletions };
}

module.exports = { unifiedDiff };
