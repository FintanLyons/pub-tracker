import AsyncStorage from '@react-native-async-storage/async-storage';
import MOCK_PUBS from '../pubs_data_short.js';
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

function coerceToPubArray(value) {
	if (!value && value !== 0) return [];
	if (Array.isArray(value)) return value;
	if (typeof value === 'object') {
		if (Array.isArray(value.pubs)) return value.pubs;
		if (Array.isArray(value.pub)) return value.pub;
		if (value.pub && typeof value.pub === 'object' && value.pub.id) return [value.pub];
		for (const k of Object.keys(value)) {
			if (Array.isArray(value[k])) return value[k];
		}
		if (value.id && value.lat && value.lon) return [value];
	}
	return [];
}

async function loadIdSet(storageKey) {
	const set = new Set();
	const raw = await AsyncStorage.getItem(storageKey);
	if (!raw) return set;

	try {
		const parsed = JSON.parse(raw);
		const arr = Array.isArray(parsed) ? parsed : coerceToPubArray(parsed);
		if (Array.isArray(arr)) {
			arr.forEach((id) => {
				if (typeof id === 'string') set.add(id);
			});
		}
	} catch (error) {
		console.warn(`${storageKey} in AsyncStorage is malformed, clearing it`, error);
		await AsyncStorage.removeItem(storageKey);
	}
	return set;
}

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
			console.warn('Server visited/favorite fetch failed, using local cache:', e.message);
		}
	}

	const [visitedSet, favoritesSet] = await Promise.all([
		loadIdSet('visitedPubs'),
		loadIdSet('favoritePubs'),
	]);
	return { visitedSet, favoritesSet };
};

export const clearVisitedFavoriteCache = () => {
	_visitedSet = null;
	_favoritesSet = null;
	_cacheUserId = null;
};

export const migrateLocalDataToServer = async () => {
	try {
		const migrated = await AsyncStorage.getItem('server_migration_done');
		if (migrated === 'true') return;

		const session = await getCurrentSession();
		if (!session?.userId) return;

		const [visitedSet, favoritesSet] = await Promise.all([
			loadIdSet('visitedPubs'),
			loadIdSet('favoritePubs'),
		]);

		if (visitedSet.size > 0) {
			const rows = [...visitedSet].map((pubId) => ({
				user_id: session.userId,
				pub_id: pubId,
			}));
			await supabase.from('visited_pubs').upsert(rows, { onConflict: 'user_id,pub_id' });
		}

		if (favoritesSet.size > 0) {
			const rows = [...favoritesSet].map((pubId) => ({
				user_id: session.userId,
				pub_id: pubId,
			}));
			await supabase.from('favorite_pubs').upsert(rows, { onConflict: 'user_id,pub_id' });
		}

		await AsyncStorage.setItem('server_migration_done', 'true');
		clearVisitedFavoriteCache();
		console.log(`Migration complete: ${visitedSet.size} visits, ${favoritesSet.size} favorites`);
	} catch (error) {
		console.error('Migration error (will retry next launch):', error);
	}
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

		try {
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
			console.log(`Fetched ${formattedPubs.length} pubs from Supabase`);

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
		} catch (supabaseError) {
			console.error('Supabase fetch error:', supabaseError);
			console.log('Falling back to mock data');
		}

		// Fallback to mock data
		let pubs = MOCK_PUBS.map((pub) => ({
			...pub,
			borough:
				typeof pub.borough === 'string' && pub.borough.trim().length > 0
					? pub.borough.trim()
					: null,
			isVisited: visitedSet.has(pub.id),
			isFavorite: favoritesSet.has(pub.id),
		}));

		if (hasBoroughFilter) {
			const boroughFilterSet = new Set(requestedBoroughs.map((b) => b.toLowerCase()));
			pubs = pubs.filter((pub) => pub.borough && boroughFilterSet.has(pub.borough.toLowerCase()));
		}

		return hasBounds
			? pubs.filter((pub) => {
				const lat = Number.parseFloat(pub.lat);
				const lon = Number.parseFloat(pub.lon);
				if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
				return lat <= bounds.north && lat >= bounds.south && lon >= bounds.west && lon <= bounds.east;
			})
			: pubs;
	} catch (error) {
		console.error('fetchLondonPubs error:', error);
		return MOCK_PUBS.map((pub) => ({ ...pub, isVisited: false, isFavorite: false }));
	}
};

export const fetchBoroughSummaries = async () => {
	try {
		const { visitedSet } = await loadVisitedAndFavoriteSets();

		try {
			let allRows = [];
			let from = 0;
			let hasMore = true;

			while (hasMore) {
				const to = from + PAGE_SIZE - 1;
				const { data: batch, error } = await supabase
					.from('pubs_all')
					.select('id, borough, lat, lon')
					.not('borough', 'is', null)
					.range(from, to);

				if (error) throw error;

				if (batch && batch.length > 0) {
					allRows = allRows.concat(batch);
					from += batch.length;
					hasMore = batch.length === PAGE_SIZE;
					if (allRows.length > SAFETY_LIMIT) {
						hasMore = false;
					}
				} else {
					hasMore = false;
				}
			}

			const aggregated = new Map();

			allRows.forEach((row) => {
				if (!row || typeof row.borough !== 'string') return;
				const rawName = row.borough.trim();
				if (!rawName) return;

				const coordinateEntry = BOROUGH_COORDINATE_MAP.get(rawName.toLowerCase());
				const canonicalName = coordinateEntry ? coordinateEntry.name : rawName;

				const idString =
					typeof row.id === 'string' ? row.id : row.id != null ? String(row.id) : null;
				const lat = Number.parseFloat(row.lat);
				const lon = Number.parseFloat(row.lon);

				let bucket = aggregated.get(canonicalName);
				if (!bucket) {
					bucket = {
						borough: canonicalName,
						totalPubs: 0,
						visitedPubs: 0,
						minLat: Infinity,
						maxLat: -Infinity,
						minLon: Infinity,
						maxLon: -Infinity,
					};
					aggregated.set(canonicalName, bucket);
				}

				bucket.totalPubs += 1;
				if (idString && visitedSet.has(idString)) bucket.visitedPubs += 1;

				if (Number.isFinite(lat) && Number.isFinite(lon)) {
					bucket.minLat = Math.min(bucket.minLat, lat);
					bucket.maxLat = Math.max(bucket.maxLat, lat);
					bucket.minLon = Math.min(bucket.minLon, lon);
					bucket.maxLon = Math.max(bucket.maxLon, lon);
				}
			});

			const summaries = boroughCoordinates.map((entry) => {
				const stats = aggregated.get(entry.borough);
				if (stats) aggregated.delete(entry.borough);

				const totalPubs = stats?.totalPubs ?? 0;
				const visitedPubs = stats?.visitedPubs ?? 0;
				const completionPercentage = totalPubs > 0 ? (visitedPubs / totalPubs) * 100 : 0;

				return {
					borough: entry.borough,
					center: entry.center,
					bounds:
						stats && Number.isFinite(stats.minLat) && Number.isFinite(stats.minLon)
							? { north: stats.maxLat, south: stats.minLat, east: stats.maxLon, west: stats.minLon }
							: null,
					totalPubs,
					visitedPubs,
					completionPercentage,
				};
			});

			aggregated.forEach((stats, boroughName) => {
				const totalPubs = stats.totalPubs;
				const visitedPubs = stats.visitedPubs;
				const completionPercentage = totalPubs > 0 ? (visitedPubs / totalPubs) * 100 : 0;
				const bounds =
					Number.isFinite(stats.minLat) && Number.isFinite(stats.minLon)
						? { north: stats.maxLat, south: stats.minLat, east: stats.maxLon, west: stats.minLon }
						: null;

				summaries.push({
					borough: boroughName,
					center:
						bounds != null
							? { latitude: (stats.minLat + stats.maxLat) / 2, longitude: (stats.minLon + stats.maxLon) / 2 }
							: null,
					bounds,
					totalPubs,
					visitedPubs,
					completionPercentage,
				});
			});

			return summaries.sort((a, b) => a.borough.localeCompare(b.borough));
		} catch (error) {
			console.error('Supabase fetchBoroughSummaries error:', error);
		}

		// Fallback to mock data
		const grouped = new Map();
		MOCK_PUBS.forEach((pub) => {
			if (!pub) return;
			const rawName =
				typeof pub.borough === 'string' && pub.borough.trim().length > 0
					? pub.borough.trim()
					: null;
			if (!rawName) return;
			const coordinateEntry = BOROUGH_COORDINATE_MAP.get(rawName.toLowerCase());
			const canonicalName = coordinateEntry ? coordinateEntry.name : rawName;
			if (!grouped.has(canonicalName)) grouped.set(canonicalName, []);
			grouped.get(canonicalName).push(pub);
		});

		const fallbackSummaries = boroughCoordinates.map((entry) => {
			const pubs = grouped.get(entry.borough) || [];
			const latitudes = [];
			const longitudes = [];

			pubs.forEach((pub) => {
				const lat = Number.parseFloat(pub.lat);
				const lon = Number.parseFloat(pub.lon);
				if (Number.isFinite(lat) && Number.isFinite(lon)) {
					latitudes.push(lat);
					longitudes.push(lon);
				}
			});

			const visitedPubs = pubs.reduce((count, pub) => (visitedSet.has(pub.id) ? count + 1 : count), 0);
			const completionPercentage = pubs.length > 0 ? (visitedPubs / pubs.length) * 100 : 0;

			return {
				borough: entry.borough,
				center: entry.center,
				bounds:
					latitudes.length > 0 && longitudes.length > 0
						? { north: Math.max(...latitudes), south: Math.min(...latitudes), east: Math.max(...longitudes), west: Math.min(...longitudes) }
						: null,
				totalPubs: pubs.length,
				visitedPubs,
				completionPercentage,
			};
		});

		grouped.forEach((pubs, boroughName) => {
			const hasCoordinate = BOROUGH_COORDINATE_MAP.has(boroughName.toLowerCase());
			if (hasCoordinate) return;

			const latitudes = [];
			const longitudes = [];
			pubs.forEach((pub) => {
				const lat = Number.parseFloat(pub.lat);
				const lon = Number.parseFloat(pub.lon);
				if (Number.isFinite(lat) && Number.isFinite(lon)) {
					latitudes.push(lat);
					longitudes.push(lon);
				}
			});

			const visitedPubs = pubs.reduce((count, pub) => (visitedSet.has(pub.id) ? count + 1 : count), 0);
			const completionPercentage = pubs.length > 0 ? (visitedPubs / pubs.length) * 100 : 0;

			fallbackSummaries.push({
				borough: boroughName,
				center:
					latitudes.length > 0 && longitudes.length > 0
						? { latitude: latitudes.reduce((s, v) => s + v, 0) / latitudes.length, longitude: longitudes.reduce((s, v) => s + v, 0) / longitudes.length }
						: null,
				bounds:
					latitudes.length > 0 && longitudes.length > 0
						? { north: Math.max(...latitudes), south: Math.min(...latitudes), east: Math.max(...longitudes), west: Math.min(...longitudes) }
						: null,
				totalPubs: pubs.length,
				visitedPubs,
				completionPercentage,
			});
		});

		return fallbackSummaries.sort((a, b) => a.borough.localeCompare(b.borough));
	} catch (error) {
		console.error('fetchBoroughSummaries error:', error);
		return [];
	}
};

// ---------------------------------------------------------------------------
// Toggle visited / favorite
// ---------------------------------------------------------------------------

export const togglePubVisited = async (pubId) => {
	if (!pubId) throw new Error('togglePubVisited called without pubId');

	const session = await getCurrentSession();
	const hasServer = !!session?.userId;

	const isCurrentlyVisited = _visitedSet
		? _visitedSet.has(pubId)
		: (await loadIdSet('visitedPubs')).has(pubId);

	if (hasServer) {
		if (isCurrentlyVisited) {
			const { error } = await supabase
				.from('visited_pubs')
				.delete()
				.eq('user_id', session.userId)
				.eq('pub_id', pubId);
			if (error) throw error;
		} else {
			const { error } = await supabase
				.from('visited_pubs')
				.insert({ user_id: session.userId, pub_id: pubId });
			if (error) throw error;
		}
	}

	if (_visitedSet) {
		if (isCurrentlyVisited) _visitedSet.delete(pubId);
		else _visitedSet.add(pubId);
	}

	const localSet = await loadIdSet('visitedPubs');
	if (localSet.has(pubId)) localSet.delete(pubId);
	else localSet.add(pubId);
	await AsyncStorage.setItem('visitedPubs', JSON.stringify([...localSet]));

	return _visitedSet || localSet;
};

export const togglePubFavorite = async (pubId) => {
	if (!pubId) throw new Error('togglePubFavorite called without pubId');

	const session = await getCurrentSession();
	const hasServer = !!session?.userId;

	const isCurrentlyFavorite = _favoritesSet
		? _favoritesSet.has(pubId)
		: (await loadIdSet('favoritePubs')).has(pubId);

	if (hasServer) {
		if (isCurrentlyFavorite) {
			const { error } = await supabase
				.from('favorite_pubs')
				.delete()
				.eq('user_id', session.userId)
				.eq('pub_id', pubId);
			if (error) throw error;
		} else {
			const { error } = await supabase
				.from('favorite_pubs')
				.insert({ user_id: session.userId, pub_id: pubId });
			if (error) throw error;
		}
	}

	if (_favoritesSet) {
		if (isCurrentlyFavorite) _favoritesSet.delete(pubId);
		else _favoritesSet.add(pubId);
	}

	const localSet = await loadIdSet('favoritePubs');
	if (localSet.has(pubId)) localSet.delete(pubId);
	else localSet.add(pubId);
	await AsyncStorage.setItem('favoritePubs', JSON.stringify([...localSet]));

	return _favoritesSet || localSet;
};
