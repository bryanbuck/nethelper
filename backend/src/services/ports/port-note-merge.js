/**
 * Port Identity: what a device merge does with port notes (called inside the
 * merge transaction, device-merge.service.js).
 *
 * A source's note moves to the kept device unless the kept device already has
 * one for that port. Then the kept note wins: its empty fields are filled from
 * the source's, and a source value that differs is appended to its notes, so
 * nothing a user typed is lost. Revisions move with their device. Sightings
 * and read states are not moved: they cascade with the source and are rebuilt
 * by the next read (re-pointing could collide on (deviceId, port, mac)).
 */

const FIELDS = ['label', 'location', 'owner', 'expectedMac'];

function foldNote(kept, extra, sourceName) {
  const data = {};
  const lines = [];
  for (const f of FIELDS) {
    if (!extra[f]) continue;
    if (!kept[f]) data[f] = extra[f];
    else if (kept[f] !== extra[f]) lines.push(`${f}: ${extra[f]}`);
  }
  if ((!kept.kind || kept.kind === 'auto') && extra.kind && extra.kind !== 'auto') data.kind = extra.kind;
  else if (extra.kind && extra.kind !== 'auto' && extra.kind !== kept.kind) lines.push(`kind: ${extra.kind}`);
  if (extra.notes) lines.push(extra.notes);
  if (lines.length) {
    const block = [`[merged from ${sourceName}]`, ...lines].join('\n');
    data.notes = kept.notes ? `${kept.notes}\n\n${block}` : block;
  }
  return data;
}

/**
 * @param tx       Prisma transaction client
 * @param ids      source device ids (merged away)
 * @param targetId kept device id
 * @param names    Map id -> device name, for the merged-from line
 */
async function mergePortNotes(tx, ids, targetId, names = new Map()) {
  const notes = await tx.portNote.findMany({ where: { deviceId: { in: [targetId, ...ids] } } });
  const kept = new Map(notes.filter((n) => n.deviceId === targetId).map((n) => [n.port, n]));
  for (const note of notes.filter((n) => n.deviceId !== targetId)) {
    const existing = kept.get(note.port);
    if (!existing) {
      await tx.portNote.update({ where: { id: note.id }, data: { deviceId: targetId } });
      kept.set(note.port, { ...note, deviceId: targetId });
      continue;
    }
    const data = foldNote(existing, note, names.get(note.deviceId) || note.deviceId);
    if (Object.keys(data).length) {
      await tx.portNote.update({ where: { id: existing.id }, data });
      Object.assign(existing, data);
    }
  }
  await tx.portNoteRevision.updateMany({ where: { deviceId: { in: ids } }, data: { deviceId: targetId } });
}

module.exports = { mergePortNotes, foldNote };
