import boroughCoordinates from '../data/boroughCoordinates.json';
import { supabase } from '../config/supabase';

const BOROUGH_COORDINATE_MAP = new Map(
	boroughCoordinates.map((entry) => [
		entry.borough.toLowerCase(),
		{
			name: entry.borough,
			center: entry.center,
		},
	]),
);

// ---------------------------------------------------------------------------
// Server-side visited / favorite tracking
// ---------------------------------------------------------------------------

let _visitedSet = null;
let _favoritesSet = null;
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

export const clearVisitedFavoriteCache = () => {
	_visitedSet = null;
	_favoritesSet = null;
	_cacheUserId = null;
};

// ---------------------------------------------------------------------------
// Pub fetching (paginated via Supabase JS client)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 500;
const SAFETY_LIMIT = 5000;

const convertFeaturesToArray = (pub) => {
	const features = [];
	if (pub.has_pub_garden) features.push('Pub garden');
	if (pub.has_live_music) features.push('Live music');
	if (pub.has_food_available) features.push('Food available');
	if (pub.has_dog_friendly) features.push('Dog friendly');
	if (pub.has_pool_darts) features.push('Pool/darts');
	if (pub.has_parking) features.push('Parking');
	if (pub.has_accommodation) features.push('Accommodation');
	if (pub.has_cask_real_ale) features.push('Cask/real ale');
	return features;
};

const formatPub = (pub, visitedSet, favoritesSet) => {
	const borough =
		typeof pub.borough === 'string' && pub.borough.trim().length > 0
			? pub.borough.trim()
			: null;
	return {
		id: pub.id,
		name: pub.name,
		lat: parseFloat(pub.lat),
		lon: parseFloat(pub.lon),
		address: pub.address,
		phone: pub.phone,
		description: pub.description,
		founded: pub.founded,
		history: pub.history,
		area: pub.area,
		borough,
		ownership: pub.ownership,
		photoUrl: pub.photo_url,
		points: pub.points || 10,
		features: convertFeaturesToArray(pub),
		achievements: pub.achievement ? [pub.achievement] : [],
		isVisited: visitedSet.has(pub.id),
		isFavorite: favoritesSet.has(pub.id),
	};
};

export const fetchLondonPubs = async (options = {}) => {
	try {
		const { bounds, boroughs } = options || {};
		const hasBounds =
			bounds &&
			typeof bounds === 'object' &&
			['north', 'south', 'east', 'west'].every((key) => Number.isFinite(bounds[key]));
		const requestedBoroughs = Array.isArray(boroughs)
			? boroughs.filter((b) => typeof b === 'string' && b.trim().length > 0)
			: [];
		const hasBoroughFilter = requestedBoroughs.length > 0;

		const { visitedSet, favoritesSet } = await loadVisitedAndFavoriteSets();

		let allPubs = [];
		let from = 0;
		let hasMore = true;

		while (hasMore) {
			let query = supabase.from('pubs_all').select('*');

			if (hasBounds) {
				query = query
					.lte('lat', bounds.north)
					.gte('lat', bounds.south)
					.gte('lon', bounds.west)
					.lte('lon', bounds.east);
			}
			if (hasBoroughFilter) {
				query = query.in('borough', requestedBoroughs);
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

		const formattedPubs = allPubs.map((p) => formatPub(p, visitedSet, favoritesSet));

		let filteredPubs = hasBounds
			? formattedPubs.filter((pub) => {
				if (!Number.isFinite(pub.lat) || !Number.isFinite(pub.lon)) return false;
				return (
					pub.lat <= bounds.north &&
					pub.lat >= bounds.south &&
					pub.lon >= bounds.west &&
					pub.lon <= bounds.east
				);
			})
			: formattedPubs;

		if (hasBoroughFilter) {
			const boroughFilterSet = new Set(requestedBoroughs.map((b) => b.toLowerCase()));
			filteredPubs = filteredPubs.filter(
				(pub) => pub.borough && boroughFilterSet.has(pub.borough.toLowerCase()),
			);
		}

		return filteredPubs;
	} catch (error) {
		console.error('fetchLondonPubs error:', error);
		return [];
	}
};

export const fetchBoroughSummaries = async (userId) => {
	try {
		if (!userId) return [];

		const { data, error } = await supabase.rpc('get_borough_stats', { p_user_id: userId });
		if (error) throw error;

		return (data || []).map((row) => {
			// Use hardcoded coordinates for known boroughs — more accurate than pub-weighted average
			const coordinateEntry = BOROUGH_COORDINATE_MAP.get(row.borough?.toLowerCase());
			const center = coordinateEntry
				? coordinateEntry.center
				: (Number.isFinite(row.center_lat) && Number.isFinite(row.center_lon))
					? { latitude: row.center_lat, longitude: row.center_lon }
					: null;

			const hasBounds =
				Number.isFinite(row.min_lat) && Number.isFinite(row.min_lon) &&
				Number.isFinite(row.max_lat) && Number.isFinite(row.max_lon);

			return {
				borough: row.borough,
				center,
				bounds: hasBounds
					? { north: row.max_lat, south: row.min_lat, east: row.max_lon, west: row.min_lon }
					: null,
				totalPubs: Number(row.total_pubs),
				visitedPubs: Number(row.visited_pubs),
				completionPercentage: Number(row.percentage),
			};
		});
	} catch (error) {
		console.error('fetchBoroughSummaries error:', error);
		return [];
	}
};

// ---------------------------------------------------------------------------
// Server-side pub search (uses search_pubs RPC)
// ---------------------------------------------------------------------------

export const searchPubsByName = async (query, limit = 5) => {
	if (!query || typeof query !== 'string' || !query.trim()) return [];

	const { data, error } = await supabase.rpc('search_pubs', {
		p_query: query.trim(),
		p_limit: limit,
	});

	if (error) throw error;
	return (data || []).map((p) => ({
		id: p.id,
		name: p.name,
		lat: parseFloat(p.lat),
		lon: parseFloat(p.lon),
		area: p.area,
		borough: p.borough,
	}));
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

	// Ensure we have the latest server-backed set in memory
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

	// Ensure we have the latest server-backed set in memory
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
