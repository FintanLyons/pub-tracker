/**
 * Visited toggles the server stats don't reflect yet, so map completion colours and
 * area labels can update instantly and then hand over to the server numbers.
 *
 * Entries: Map pubId → { district, area, base, desired, savedAt }
 *   base    — visited state the current server stats reflect (value before the first tap)
 *   desired — what the user chose last
 *   savedAt — when the latest write finished (null while in flight)
 * An entry is dropped once stats fetched *after* savedAt arrive (see pruneVisitChanges).
 * All functions return new Maps (safe for React state).
 */

const key = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export function recordVisitChange(entries, { pubId, district, area, previous, desired }) {
  const next = new Map(entries);
  const current = entries.get(pubId);
  next.set(pubId, {
    district: key(district),
    area: key(area),
    base: current ? current.base : Boolean(previous),
    desired: Boolean(desired),
    savedAt: null,
  });
  return next;
}

/** The write for this pub finished (successfully, or failed and the UI reverted). */
export function markVisitSaved(entries, pubId, { desired, at }) {
  const current = entries.get(pubId);
  if (!current) return entries;
  const next = new Map(entries);
  next.set(pubId, { ...current, desired: Boolean(desired), savedAt: at });
  return next;
}

/** Drop entries the server stats now include (their fetch started after the save). */
export function pruneVisitChanges(entries, statsAsOf) {
  let changed = false;
  const next = new Map();
  entries.forEach((entry, pubId) => {
    if (entry.savedAt != null && entry.savedAt <= statsAsOf) {
      changed = true;
    } else {
      next.set(pubId, entry);
    }
  });
  return changed ? next : entries;
}

/** Net +/− visited per district and per postcode area (lower-case keys). */
export function visitDeltas(entries) {
  const byDistrict = new Map();
  const byArea = new Map();
  entries.forEach((entry) => {
    const delta = Number(entry.desired) - Number(entry.base);
    if (!delta) return;
    if (entry.district) byDistrict.set(entry.district, (byDistrict.get(entry.district) || 0) + delta);
    if (entry.area) byArea.set(entry.area, (byArea.get(entry.area) || 0) + delta);
  });
  return { byDistrict, byArea };
}

const clampVisited = (visited, total) => Math.max(0, Math.min(total, visited));

/** Server district stats (+ pending deltas) → Map district(lower) → { total, visited }. */
export function districtStatsWithDeltas(districtStats, deltas) {
  const map = new Map();
  (districtStats || []).forEach((row) => {
    const k = key(row.district);
    if (!k) return;
    const total = Number(row.total) || 0;
    map.set(k, { total, visited: clampVisited((Number(row.visited) || 0) + (deltas.byDistrict.get(k) || 0), total) });
  });
  return map;
}

/** Server postcode-area stats (+ pending deltas) → summaries for the area layer / camera. */
export function areaSummariesWithDeltas(areaStats, deltas) {
  return (areaStats || []).map((row) => {
    const total = Number(row.totalPubs) || 0;
    const visited = clampVisited((Number(row.visitedPubs) || 0) + (deltas.byArea.get(key(row.postcodeArea)) || 0), total);
    return {
      postcodeArea: row.postcodeArea,
      center: Number.isFinite(row.centerLat) && Number.isFinite(row.centerLon)
        ? { latitude: row.centerLat, longitude: row.centerLon }
        : null,
      bounds: row.bounds || null,
      totalPubs: total,
      visitedPubs: visited,
      completionPercentage: total > 0 ? Math.round((visited / total) * 100) : 0,
      totalDistricts: row.totalDistricts,
      completedDistricts: row.completedDistricts,
    };
  });
}
