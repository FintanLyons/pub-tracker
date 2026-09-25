export const CORE_LONDON_AREAS = new Set(['E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC']);

/** Postcode letter-areas shown in the app (map, stats, search, trophies). */
export const SUPPORTED_POSTCODE_AREAS = new Set([...CORE_LONDON_AREAS, 'CB']);
