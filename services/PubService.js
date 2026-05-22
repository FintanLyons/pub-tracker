import { supabase } from '../config/supabase';
import { PUB_FEATURE_CHIPS } from '../constants/pubFeatureChips';
import { getPostcodeDistrictDisplayName } from '../utils/postcodeDistrictDisplayNames';
import { CORE_LONDON_AREAS } from '../constants/londonAreas';
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

const fetchServerIdSet = async (table, userId) => {
	const { data, error } = await supabase
		.from(table)
		.select('pub_id')
		.eq('user_id', userId);

	if (error) return null;
	return new Set((data || []).map((r) => r.pub_id));
};

const loadVisitedAndFavoriteSets = async () => {
	const session = await getCurrentSession();

	if (session?.userId) {
		if (_cacheUserId === session.userId && _visitedSet && _favoritesSet) {
			return { visitedSet: _visitedSet, favoritesSet: _favoritesSet };
		}
		try {
			const [visited, favorites] = await Promise.all([
				fetchServerIdSet('visited_pubs', session.userId),
				fetchServerIdSet('favorite_pubs', session.userId),
			]);
			if (visited !== null && favorites !== null) {
				_visitedSet = visited;
				_favoritesSet = favorites;
				_cacheUserId = session.userId;
				return { visitedSet: visited, favoritesSet: favorites };
			}
		} catch (e) {
			console.warn('Server visited/favorite fetch failed:', e.message);
		}
	}

	// No authenticated user or server fetch failed – treat as no visits/favourites.
	return { visitedSet: new Set(), favoritesSet: new Set() };
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

const convertFeaturesToArray = (pub) =>
	PUB_FEATURE_CHIPS.filter((f) => pub[f.flag] === true).map((f) => f.name);

const formatPub = (pub, visitedSet, favoritesSet, achievementsByPubId = {}) => {
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
		history:
			(typeof pub.description === 'string' && pub.description.trim()) ||
			(typeof pub.history === 'string' && pub.history.trim()) ||
			null,
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
		opening_hours:
			(typeof pub.opening_hours === 'string' && pub.opening_hours.trim()) ||
			(typeof pub.openning_hours === 'string' && pub.openning_hours.trim()) ||
			null,
		points: 10,
		features: convertFeaturesToArray(pub),
		achievements: achievementsByPubId[pub.id] || [],
		isActive: pub.is_active !== false,
		isVisited: visitedSet.has(pub.id),
		isFavorite: favoritesSet.has(pub.id),
		avgRating: null,
		reviewCount: 0,
	};
};

const attachRatingSummary = (pub, summary) => ({
	...pub,
	avgRating: summary?.avgRating ?? null,
	reviewCount: summary?.reviewCount ?? 0,
});

export const fetchLondonPubs = async (options = {}) => {
	try {
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
			let query = supabase.from('Pubs_List').select('*').eq('is_active', true);

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
				formatPub(p, visitedSet, favoritesSet, achievementsByPubId),
				ratingSummaries[p.id],
			),
		);

		const isCoreLondonPostcodeArea = (pub) => {
			const area = pub.postcodeArea || pub.borough;
			if (!area || typeof area !== 'string') return false;
			return CORE_LONDON_AREAS.has(area.trim().toUpperCase());
		};

		const londonPubsOnly = formattedPubs.filter(isCoreLondonPostcodeArea);

		let filteredPubs = hasBounds
			? londonPubsOnly.filter((pub) => {
				if (!Number.isFinite(pub.lat) || !Number.isFinite(pub.lon)) return false;
				return (
					pub.lat <= bounds.north &&
					pub.lat >= bounds.south &&
					pub.lon >= bounds.west &&
					pub.lon <= bounds.east
				);
			})
			: londonPubsOnly;

		if (hasAreaFilter) {
			const areaSet = new Set(requestedAreas.map((b) => b.toLowerCase()));
			filteredPubs = filteredPubs.filter(
				(pub) => pub.postcodeArea && areaSet.has(pub.postcodeArea.toLowerCase()),
			);
		}

		return filteredPubs;
	} catch (error) {
		console.error('fetchLondonPubs error:', error);
		return [];
	}
};

/** Summaries for map colouring at postcode-area zoom (uses get_borough_stats RPC). */
export const fetchPostcodeAreaSummaries = async (userId) => {
	try {
		if (!userId) return [];

		const { data, error } = await supabase.rpc('get_borough_stats', { p_user_id: userId });
		if (error) throw error;

	return (data || []).filter((row) => row.postcode_area && CORE_LONDON_AREAS.has(row.postcode_area)).map((row) => {
		const center = (Number.isFinite(row.center_lat) && Number.isFinite(row.center_lon))
			? { latitude: row.center_lat, longitude: row.center_lon }
			: null;

		const hasBounds =
			Number.isFinite(row.min_lat) && Number.isFinite(row.min_lon) &&
			Number.isFinite(row.max_lat) && Number.isFinite(row.max_lon);

		return {
			postcodeArea: row.postcode_area,
			center,
			bounds: hasBounds
				? { north: row.max_lat, south: row.min_lat, east: row.max_lon, west: row.min_lon }
				: null,
			totalPubs: Number(row.total_pubs),
			visitedPubs: Number(row.visited_pubs),
			completionPercentage: Number(row.percentage),
			totalDistricts: Number(row.total_districts),
			completedDistricts: Number(row.completed_districts),
		};
	});
	} catch (error) {
		console.error('fetchPostcodeAreaSummaries error:', error);
		return [];
	}
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
			return pa && CORE_LONDON_AREAS.has(pa);
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
// Toggle visited / favorite
// ---------------------------------------------------------------------------

export const togglePubVisited = async (pubId) => {
	if (!pubId) throw new Error('togglePubVisited called without pubId');

	const session = await getCurrentSession();
	if (!session?.userId) {
		throw new Error('You need to be logged in and online to track visited pubs.');
	}

	if (!_visitedSet || _cacheUserId !== session.userId) {
		const { visitedSet } = await loadVisitedAndFavoriteSets();
		_visitedSet = visitedSet;
		_cacheUserId = session.userId;
	}

	const isCurrentlyVisited = _visitedSet.has(pubId);

	if (isCurrentlyVisited) {
		const { error } = await supabase
			.from('visited_pubs')
			.delete()
			.eq('user_id', session.userId)
			.eq('pub_id', pubId);
		if (error) throw error;
		_visitedSet.delete(pubId);
	} else {
		const { error } = await supabase
			.from('visited_pubs')
			.insert({ user_id: session.userId, pub_id: pubId });
		if (error) throw error;
		_visitedSet.add(pubId);
	}

	return _visitedSet;
};

export const togglePubFavorite = async (pubId) => {
	if (!pubId) throw new Error('togglePubFavorite called without pubId');

	const session = await getCurrentSession();
	if (!session?.userId) {
		throw new Error('You need to be logged in and online to track favourite pubs.');
	}

	if (!_favoritesSet || _cacheUserId !== session.userId) {
		const { favoritesSet } = await loadVisitedAndFavoriteSets();
		_favoritesSet = favoritesSet;
		_cacheUserId = session.userId;
	}

	const isCurrentlyFavorite = _favoritesSet.has(pubId);

	if (isCurrentlyFavorite) {
		const { error } = await supabase
			.from('favorite_pubs')
			.delete()
			.eq('user_id', session.userId)
			.eq('pub_id', pubId);
		if (error) throw error;
		_favoritesSet.delete(pubId);
	} else {
		const { error } = await supabase
			.from('favorite_pubs')
			.insert({ user_id: session.userId, pub_id: pubId });
		if (error) throw error;
		_favoritesSet.add(pubId);
	}

	return _favoritesSet;
};
