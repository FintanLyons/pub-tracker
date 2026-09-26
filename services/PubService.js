import { supabase } from '../config/supabase';
import { PUB_FEATURE_CHIPS } from '../constants/pubFeatureChips';
import { getPostcodeDistrictDisplayName } from '../utils/postcodeDistrictDisplayNames';
import { SUPPORTED_POSTCODE_AREAS } from '../constants/londonAreas';
import { getPubRatingSummariesCached } from './ReviewService';

// ---------------------------------------------------------------------------
// Server-side visited / favorite tracking
// ---------------------------------------------------------------------------

let _visitedSet = null;
let _favoritesSet = null;
let _achievementsByPubId = null;
let _cacheUserId = null;

const getCurrentSession = async () => {
	try {
		const { data: { session } } = await supabase.auth.getSession();
		if (!session?.access_token) return null;
		return {
			accessToken: session.access_token,
			userId: session.user?.id || null,
		};
	} catch {
		return null;
	}
};

/** PostgREST returns at most 1000 rows per request — read the user's ids in pages. */
const ID_PAGE_SIZE = 1000;

const fetchServerIdSet = async (table, userId) => {
	const ids = new Set();
	for (let from = 0; ; from += ID_PAGE_SIZE) {
		const { data, error } = await supabase
			.from(table)
			.select('pub_id')
			.eq('user_id', userId)
			.order('pub_id', { ascending: true })
			.range(from, from + ID_PAGE_SIZE - 1);
		if (error) return null;
		(data || []).forEach((r) => ids.add(r.pub_id));
		if (!data || data.length < ID_PAGE_SIZE) return ids;
	}
};

const loadVisitedAndFavoriteSets = async () => {
	const session = await getCurrentSession();
	if (!session?.userId) return { visitedSet: new Set(), favoritesSet: new Set() };

	if (_cacheUserId === session.userId && _visitedSet && _favoritesSet) {
		return { visitedSet: _visitedSet, favoritesSet: _favoritesSet };
	}
	const [visited, favorites] = await Promise.all([
		fetchServerIdSet('visited_pubs', session.userId),
		fetchServerIdSet('favorite_pubs', session.userId),
	]);
	// Never fall back to "no visits" — every pub would wrongly show as unvisited.
	if (visited === null || favorites === null) {
		throw new Error('Could not load your visited / favourite pubs');
	}
	_visitedSet = visited;
	_favoritesSet = favorites;
	_cacheUserId = session.userId;
	return { visitedSet: visited, favoritesSet: favorites };
};

const loadPubAchievementsByPubId = async () => {
	if (_achievementsByPubId) return _achievementsByPubId;

	try {
		const { data, error } = await supabase
			.from('pub_achievements')
			.select('pub_id, title, sort_order')
			.order('sort_order', { ascending: true });

		if (error) throw error;

		const byPubId = {};
		for (const row of data || []) {
			if (!row?.pub_id || !row?.title) continue;
			if (!byPubId[row.pub_id]) byPubId[row.pub_id] = [];
			byPubId[row.pub_id].push(row.title);
		}
		_achievementsByPubId = byPubId;
		return byPubId;
	} catch (e) {
		console.warn('pub_achievements fetch failed (table may not exist yet):', e.message);
		_achievementsByPubId = {};
		return {};
	}
};

export const clearVisitedFavoriteCache = () => {
	_visitedSet = null;
	_favoritesSet = null;
	_achievementsByPubId = null;
	_cacheUserId = null;
};

/** Union of favourite pub ids for the given user ids (self and/or friends). */
export const fetchFavoritePubIdsForUsers = async (userIds) => {
	const ids = [...new Set((userIds || []).filter(Boolean))];
	if (ids.length === 0) return new Set();

	const session = await getCurrentSession();
	if (!session?.userId) return new Set();

	const { data, error } = await supabase
		.from('favorite_pubs')
		.select('pub_id')
		.in('user_id', ids);

	if (error) throw error;
	return new Set((data || []).map((r) => r.pub_id));
};

// ---------------------------------------------------------------------------
// Pub fetching (paginated via Supabase JS client)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;
const SAFETY_LIMIT = 5000;

/**
 * Columns the map needs for markers, filters and the card's first paint. Description,
 * contact details and extra photos load when a pub is opened (fetchPubById) —
 * about 70% less data per pub than select('*').
 */
const MAP_PUB_COLUMNS = [
	'id', 'name', 'lat', 'lon', 'postcode_district', 'postcode_area',
	'ownership', 'founded', 'opening_hours', 'is_active', 'photo_url1',
	...PUB_FEATURE_CHIPS.map((f) => f.flag),
].join(',');

const convertFeaturesToArray = (pub) =>
	PUB_FEATURE_CHIPS.filter((f) => pub[f.flag] === true).map((f) => f.name);

const formatPub = (pub, visitedSet, favoritesSet, achievementsByPubId = {}, { detailsLoaded = true } = {}) => {
	// postcode_district / postcode_area live directly on pub_list rows
	const postcodeDistrict =
		typeof pub.postcode_district === 'string' && pub.postcode_district.trim().length > 0
			? pub.postcode_district.trim()
			: null;
	const postcodeArea =
		typeof pub.postcode_area === 'string' && pub.postcode_area.trim().length > 0
			? pub.postcode_area.trim()
			: null;
	// `area` = postcode district (map filters, district trophies)
	// `borough` = postcode area letters (parent grouping, area trophies)
	const area = postcodeDistrict;
	const borough = postcodeArea;
	const districtDisplayName = area ? getPostcodeDistrictDisplayName(area) : null;

	const photoUrls = [1, 2, 3, 4, 5]
		.map((i) => pub[`photo_url${i}`])
		.filter(Boolean);

	return {
		id: pub.id,
		name: pub.name,
		lat: parseFloat(pub.lat),
		lon: parseFloat(pub.lon),
		addrHousenumber:
			typeof pub.addr_housenumber === 'string' && pub.addr_housenumber.trim()
				? pub.addr_housenumber.trim()
				: null,
		addrStreet:
			typeof pub.addr_street === 'string' && pub.addr_street.trim()
				? pub.addr_street.trim()
				: null,
		phone: pub.phone,
		description: pub.description,
		// Card UI reads `history`; Pubs_List stores enriched copy in `description`.
		history: (typeof pub.description === 'string' && pub.description.trim()) || null,
		founded: pub.founded,
		area,
		borough,
		postcodeDistrict,
		postcodeArea,
		districtDisplayName,
		ownership: pub.ownership,
		website: pub.website || null,
		photoUrl: photoUrls[0] || null,
		photoUrls,
		opening_hours: (typeof pub.opening_hours === 'string' && pub.opening_hours.trim()) || null,
		features: convertFeaturesToArray(pub),
		achievements: achievementsByPubId[pub.id] || [],
		isActive: pub.is_active !== false,
		isVisited: visitedSet.has(pub.id),
		isFavorite: favoritesSet.has(pub.id),
		/** false for map rows (MAP_PUB_COLUMNS) — the card fetches full details on open. */
		detailsLoaded,
		avgRating: null,
		reviewCount: 0,
	};
};

const attachRatingSummary = (pub, summary) => ({
	...pub,
	avgRating: summary?.avgRating ?? null,
	reviewCount: summary?.reviewCount ?? 0,
});

/** Pubs for the map (optionally within bounds). Throws on failure so callers can retry. */
export const fetchLondonPubs = async (options = {}) => {
	const { bounds, postcodeAreas } = options || {};
	const hasBounds =
		bounds &&
		typeof bounds === 'object' &&
		['north', 'south', 'east', 'west'].every((key) => Number.isFinite(bounds[key]));
	const requestedAreas = Array.isArray(postcodeAreas)
		? postcodeAreas.filter((b) => typeof b === 'string' && b.trim().length > 0)
		: [];
	const hasAreaFilter = requestedAreas.length > 0;

	const [{ visitedSet, favoritesSet }, achievementsByPubId] = await Promise.all([
		loadVisitedAndFavoriteSets(),
		loadPubAchievementsByPubId(),
	]);

	let allPubs = [];
	let from = 0;
	let hasMore = true;

	while (hasMore) {
		let query = supabase.from('Pubs_List').select(MAP_PUB_COLUMNS).eq('is_active', true);

		if (hasBounds) {
			query = query
				.lte('lat', bounds.north)
				.gte('lat', bounds.south)
				.gte('lon', bounds.west)
				.lte('lon', bounds.east);
		}
		const to = from + PAGE_SIZE - 1;
		query = query.range(from, to);

		const { data: batch, error } = await query;

		if (error) throw error;

		if (batch && batch.length > 0) {
			allPubs = allPubs.concat(batch);
			from += batch.length;
			hasMore = batch.length === PAGE_SIZE;

			if (allPubs.length > SAFETY_LIMIT) {
				console.warn('Reached safety limit of pubs, stopping pagination');
				hasMore = false;
			}
		} else {
			hasMore = false;
		}
	}

	const ratingSummaries = await getPubRatingSummariesCached();
	const formattedPubs = allPubs.map((p) =>
		attachRatingSummary(
			formatPub(p, visitedSet, favoritesSet, achievementsByPubId, { detailsLoaded: false }),
			ratingSummaries[p.id],
		),
	);

	const isSupportedPostcodeArea = (pub) => {
		const area = pub.postcodeArea || pub.borough;
		if (!area || typeof area !== 'string') return false;
		return SUPPORTED_POSTCODE_AREAS.has(area.trim().toUpperCase());
	};

	const supportedPubsOnly = formattedPubs.filter(isSupportedPostcodeArea);

	let filteredPubs = hasBounds
		? supportedPubsOnly.filter((pub) => {
			if (!Number.isFinite(pub.lat) || !Number.isFinite(pub.lon)) return false;
			return (
				pub.lat <= bounds.north &&
				pub.lat >= bounds.south &&
				pub.lon >= bounds.west &&
				pub.lon <= bounds.east
			);
		})
		: supportedPubsOnly;

	if (hasAreaFilter) {
		const areaSet = new Set(requestedAreas.map((b) => b.toLowerCase()));
		filteredPubs = filteredPubs.filter(
			(pub) => pub.postcodeArea && areaSet.has(pub.postcodeArea.toLowerCase()),
		);
	}

	return filteredPubs;
};

// ---------------------------------------------------------------------------
// Server-side pub search (uses search_pubs RPC)
// ---------------------------------------------------------------------------

export const fetchPubById = async (pubId) => {
	if (!pubId) return null;

	const id = String(pubId).trim();
	if (!id) return null;

	const { data, error } = await supabase
		.from('Pubs_List')
		.select('*')
		.eq('id', id)
		.maybeSingle();

	if (error) throw error;
	if (!data) return null;

	const [{ visitedSet, favoritesSet }, achievementsByPubId, ratingSummaries] = await Promise.all([
		loadVisitedAndFavoriteSets(),
		loadPubAchievementsByPubId(),
		getPubRatingSummariesCached(),
	]);

	const pub = formatPub(data, visitedSet, favoritesSet, achievementsByPubId);
	return attachRatingSummary(pub, ratingSummaries?.[pub.id]);
};

export const searchPubsByName = async (query, limit = 5) => {
	if (!query || typeof query !== 'string' || !query.trim()) return [];

	const { data, error } = await supabase.rpc('search_pubs', {
		p_query: query.trim(),
		p_limit: limit,
	});

	if (error) throw error;
	return (data || [])
		.filter((p) => {
			const pa = p.postcode_area || p.borough;
			return pa && SUPPORTED_POSTCODE_AREAS.has(pa);
		})
		.map((p) => {
			const area = p.postcode_district || p.area;
			return {
				id: p.id,
				name: p.name,
				lat: parseFloat(p.lat),
				lon: parseFloat(p.lon),
				area,
				borough: p.postcode_area || p.borough,
				postcodeDistrict: p.postcode_district,
				postcodeArea: p.postcode_area,
				districtDisplayName: area ? getPostcodeDistrictDisplayName(area) : null,
			};
		});
};

// ---------------------------------------------------------------------------
// Set visited / favorite (idempotent — safe to repeat, never "flips")
// ---------------------------------------------------------------------------

/** Per-key promise chains so writes for the same pub reach the server in tap order. */
const _writeQueues = new Map();

const enqueueWrite = (key, task) => {
	const previous = _writeQueues.get(key) || Promise.resolve();
	const next = previous.catch(() => {}).then(task);
	_writeQueues.set(key, next);
	next.finally(() => {
		if (_writeQueues.get(key) === next) _writeQueues.delete(key);
	}).catch(() => {});
	return next;
};

const setMembership = async (table, pubId, shouldBeMember) => {
	if (!pubId) throw new Error(`set ${table} called without pubId`);

	const session = await getCurrentSession();
	if (!session?.userId) {
		throw new Error('You need to be signed in to save this.');
	}
	const { userId } = session;

	return enqueueWrite(`${table}:${pubId}`, async () => {
		const { error } = shouldBeMember
			? await supabase
				.from(table)
				.upsert(
					{ user_id: userId, pub_id: pubId },
					{ onConflict: 'user_id,pub_id', ignoreDuplicates: true },
				)
			: await supabase
				.from(table)
				.delete()
				.eq('user_id', userId)
				.eq('pub_id', pubId);
		if (error) throw error;

		if (_cacheUserId === userId) {
			const set = table === 'visited_pubs' ? _visitedSet : _favoritesSet;
			if (set) {
				if (shouldBeMember) set.add(pubId);
				else set.delete(pubId);
			}
		}
	});
};

/** Mark a pub visited (true) or not visited (false). */
export const setPubVisited = (pubId, visited) => setMembership('visited_pubs', pubId, visited);

/** Add (true) or remove (false) a pub from favourites. */
export const setPubFavorite = (pubId, favorite) => setMembership('favorite_pubs', pubId, favorite);

/**
 * Re-read the signed-in user's visited / favourite ids from the server (e.g. when the
 * app returns to the foreground, to pick up changes made on another device).
 * Resolves to null on failure.
 */
export const reloadVisitedFavoriteSets = async () => {
	const session = await getCurrentSession();
	if (!session?.userId) return null;
	const [visited, favorites] = await Promise.all([
		fetchServerIdSet('visited_pubs', session.userId),
		fetchServerIdSet('favorite_pubs', session.userId),
	]);
	// On failure keep the existing cache rather than reporting "no visits".
	if (visited === null || favorites === null) return null;
	_visitedSet = visited;
	_favoritesSet = favorites;
	_cacheUserId = session.userId;
	return { visitedSet: visited, favoritesSet: favorites };
};
