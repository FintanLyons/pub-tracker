import AsyncStorage from '@react-native-async-storage/async-storage';
import MOCK_PUBS from '../pubs_data_short.js';
import boroughCoordinates from '../data/boroughCoordinates.json';
import { getSupabaseUrl, getSupabaseHeaders } from '../config/supabase';
const BOROUGH_COORDINATE_MAP = new Map(
	boroughCoordinates.map((entry) => [
		entry.borough.toLowerCase(),
		{
			name: entry.borough,
			center: entry.center,
		},
	]),
);


// Try to find a sensible array inside whatever was parsed
function coerceToPubArray(value) {
	if (!value && value !== 0) return [];
	if (Array.isArray(value)) return value;
	if (typeof value === 'object') {
		// common bad shapes: { pubs: [...] } or { pub: [...] } or { pub: {...} }
		if (Array.isArray(value.pubs)) return value.pubs;
		if (Array.isArray(value.pub)) return value.pub;
		if (value.pub && typeof value.pub === 'object' && value.pub.id) return [value.pub];
		// If object values contain an array, return the first array found
		for (const k of Object.keys(value)) {
			if (Array.isArray(value[k])) return value[k];
		}
		// If object looks like a single pub, wrap it
		if (value.id && value.lat && value.lon) return [value];
	}
	// fallback: return empty
	return [];
}

async function loadIdSet(storageKey) {
	const set = new Set();
	const raw = await AsyncStorage.getItem(storageKey);
	if (!raw) {
		return set;
	}

	try {
		const parsed = JSON.parse(raw);
		const arr = Array.isArray(parsed) ? parsed : coerceToPubArray(parsed);
		if (Array.isArray(arr)) {
			arr.forEach((id) => {
				if (typeof id === 'string') {
					set.add(id);
				}
			});
		}
	} catch (error) {
		console.warn(`${storageKey} in AsyncStorage is malformed, clearing it`, error);
		await AsyncStorage.removeItem(storageKey);
	}

	return set;
}

export const fetchLondonPubs = async (options = {}) => {
	try {
		const { bounds, boroughs } = options || {};
		const hasBounds =
			bounds &&
			typeof bounds === 'object' &&
			['north', 'south', 'east', 'west'].every((key) => Number.isFinite(bounds[key]));
		const requestedBoroughs = Array.isArray(boroughs)
			? boroughs.filter((borough) => typeof borough === 'string' && borough.trim().length > 0)
			: [];
		const hasBoroughFilter = requestedBoroughs.length > 0;

		const formatBoundsValue = (value) => {
			if (!Number.isFinite(value)) return value;
			return Number.parseFloat(value.toFixed(6));
		};

		// Get visited pubs from local storage
		const [visitedSet, favoritesSet] = await Promise.all([
			loadIdSet('visitedPubs'),
			loadIdSet('favoritePubs'),
		]);

		// Try to fetch from Supabase
		const supabaseUrl = getSupabaseUrl();
		const headers = getSupabaseHeaders();
		
		if (supabaseUrl && headers) {
			try {
				// Fetch pubs with all columns (including feature columns and achievement)
				const supabaseQueryParams = ['select=*'];
				if (hasBounds) {
					const north = formatBoundsValue(bounds.north);
					const south = formatBoundsValue(bounds.south);
					const east = formatBoundsValue(bounds.east);
					const west = formatBoundsValue(bounds.west);

					supabaseQueryParams.push(`lat=lte.${north}`);
					supabaseQueryParams.push(`lat=gte.${south}`);
					supabaseQueryParams.push(`lon=gte.${west}`);
					supabaseQueryParams.push(`lon=lte.${east}`);
				}
				if (hasBoroughFilter) {
					const encodedBoroughs = requestedBoroughs
						.map((borough) => encodeURIComponent(`"${borough}"`))
						.join(',');
					if (encodedBoroughs.length > 0) {
						supabaseQueryParams.push(`borough=in.(${encodedBoroughs})`);
					}
				}

				const queryString = supabaseQueryParams.join('&');

				const pubsResponse = await fetch(`${supabaseUrl}/pubs?${queryString}`, {
					headers
				});
				
				if (!pubsResponse.ok) {
					throw new Error(`Supabase error: ${pubsResponse.status}`);
				}
				
				const pubs = await pubsResponse.json();
				
				// Convert boolean feature columns to features array
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
				
				// Combine and format pubs
				const formattedPubs = pubs.map(pub => {
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
					photoUrl: pub.photo_url, // Map photo_url to photoUrl for compatibility
					points: pub.points || 10,
					features: convertFeaturesToArray(pub),
					// Convert single achievement column to array for backward compatibility
					achievements: pub.achievement ? [pub.achievement] : [],
					isVisited: visitedSet.has(pub.id),
					isFavorite: favoritesSet.has(pub.id),
				}});
				
				console.log(`✅ Fetched ${formattedPubs.length} pubs from Supabase`);
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
					filteredPubs = filteredPubs.filter((pub) => {
						if (!pub.borough) return false;
						return boroughFilterSet.has(pub.borough.toLowerCase());
					});
				}

				return filteredPubs;
				
			} catch (supabaseError) {
				console.error('Supabase fetch error:', supabaseError);
				console.log('⚠️  Falling back to mock data');
				// Fall through to mock data fallback
			}
		}
		
		// Fallback to mock data if Supabase is not configured or fails
		console.log('📦 Using mock data (Supabase not configured or unavailable)');
		let pubs = MOCK_PUBS.map(pub => ({
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

		const filteredPubs = hasBounds
			? pubs.filter((pub) => {
				const lat = Number.parseFloat(pub.lat);
				const lon = Number.parseFloat(pub.lon);
				if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
				return (
					lat <= bounds.north &&
					lat >= bounds.south &&
					lon >= bounds.west &&
					lon <= bounds.east
				);
			})
			: pubs;

		return filteredPubs;
	} catch (error) {
		console.error('fetchLondonPubs error:', error);
		// Final fallback
		return MOCK_PUBS.map(pub => ({ ...pub, isVisited: false, isFavorite: false }));
	}
};

export const fetchBoroughSummaries = async () => {
	try {
		const visitedSet = await loadIdSet('visitedPubs');
		const supabaseUrl = getSupabaseUrl();
		const headers = getSupabaseHeaders();

		if (supabaseUrl && headers) {
			try {
				const queryParts = ['select=id,borough,lat,lon', 'borough=not.is.null'];

				const response = await fetch(`${supabaseUrl}/pubs?${queryParts.join('&')}`, {
					headers,
				});

				if (!response.ok) {
					throw new Error(`Supabase borough summary error: ${response.status}`);
				}

				const rows = await response.json();
				const aggregated = new Map();

				(Array.isArray(rows) ? rows : []).forEach((row) => {
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
					if (idString && visitedSet.has(idString)) {
						bucket.visitedPubs += 1;
					}

					if (Number.isFinite(lat) && Number.isFinite(lon)) {
						bucket.minLat = Math.min(bucket.minLat, lat);
						bucket.maxLat = Math.max(bucket.maxLat, lat);
						bucket.minLon = Math.min(bucket.minLon, lon);
						bucket.maxLon = Math.max(bucket.maxLon, lon);
					}
				});

				const summaries = boroughCoordinates.map((entry) => {
					const stats = aggregated.get(entry.borough);
					if (stats) {
						aggregated.delete(entry.borough);
					}

					const totalPubs = stats?.totalPubs ?? 0;
					const visitedPubs = stats?.visitedPubs ?? 0;
					const completionPercentage =
						totalPubs > 0 ? (visitedPubs / totalPubs) * 100 : 0;

					return {
						borough: entry.borough,
						center: entry.center,
						bounds:
							stats && Number.isFinite(stats.minLat) && Number.isFinite(stats.minLon)
								? {
										north: stats.maxLat,
										south: stats.minLat,
										east: stats.maxLon,
										west: stats.minLon,
								  }
								: null,
						totalPubs,
						visitedPubs,
						completionPercentage,
					};
				});

				aggregated.forEach((stats, boroughName) => {
					const totalPubs = stats.totalPubs;
					const visitedPubs = stats.visitedPubs;
					const completionPercentage =
						totalPubs > 0 ? (visitedPubs / totalPubs) * 100 : 0;

					const bounds =
						Number.isFinite(stats.minLat) && Number.isFinite(stats.minLon)
							? {
									north: stats.maxLat,
									south: stats.minLat,
									east: stats.maxLon,
									west: stats.minLon,
							  }
							: null;

					summaries.push({
						borough: boroughName,
						center:
							bounds != null
								? {
										latitude: (stats.minLat + stats.maxLat) / 2,
										longitude: (stats.minLon + stats.maxLon) / 2,
								  }
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
		}

		// Fallback to mock data
		const grouped = new Map();
		MOCK_PUBS.forEach((pub) => {
			if (!pub) {
				return;
			}
			const rawName =
				typeof pub.borough === 'string' && pub.borough.trim().length > 0
					? pub.borough.trim()
					: null;
			if (!rawName) {
				return;
			}
			const coordinateEntry = BOROUGH_COORDINATE_MAP.get(rawName.toLowerCase());
			const canonicalName = coordinateEntry ? coordinateEntry.name : rawName;

			if (!grouped.has(canonicalName)) {
				grouped.set(canonicalName, []);
			}
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

			const visitedPubs = pubs.reduce((count, pub) => {
				return visitedSet.has(pub.id) ? count + 1 : count;
			}, 0);

			const completionPercentage =
				pubs.length > 0 ? (visitedPubs / pubs.length) * 100 : 0;

			return {
				borough: entry.borough,
				center: entry.center,
				bounds:
					latitudes.length > 0 && longitudes.length > 0
						? {
								north: Math.max(...latitudes),
								south: Math.min(...latitudes),
								east: Math.max(...longitudes),
								west: Math.min(...longitudes),
						  }
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

			const visitedPubs = pubs.reduce((count, pub) => {
				return visitedSet.has(pub.id) ? count + 1 : count;
			}, 0);

			const completionPercentage =
				pubs.length > 0 ? (visitedPubs / pubs.length) * 100 : 0;

			fallbackSummaries.push({
				borough: boroughName,
				center:
					latitudes.length > 0 && longitudes.length > 0
						? {
								latitude: latitudes.reduce((sum, value) => sum + value, 0) / latitudes.length,
								longitude:
									longitudes.reduce((sum, value) => sum + value, 0) / longitudes.length,
						  }
						: null,
				bounds:
					latitudes.length > 0 && longitudes.length > 0
						? {
								north: Math.max(...latitudes),
								south: Math.min(...latitudes),
								east: Math.max(...longitudes),
								west: Math.min(...longitudes),
						  }
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

export const togglePubVisited = async (pubId) => {
	if (!pubId) throw new Error('togglePubVisited called without pubId');
	try {
		const raw = await AsyncStorage.getItem('visitedPubs');
		let visited = new Set();
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				// Expecting array of ids
				const arr = Array.isArray(parsed) ? parsed : coerceToPubArray(parsed);
				arr.forEach(id => { if (typeof id === 'string') visited.add(id); });
			} catch (e) {
				console.warn('Corrupted visitedPubs; resetting', e);
				visited = new Set();
			}
		}

		if (visited.has(pubId)) visited.delete(pubId);
		else visited.add(pubId);

		await AsyncStorage.setItem('visitedPubs', JSON.stringify([...visited]));
		return visited;
	} catch (error) {
		console.error('togglePubVisited error:', error);
		throw error;
	}
};

export const togglePubFavorite = async (pubId) => {
	if (!pubId) throw new Error('togglePubFavorite called without pubId');
	try {
		const raw = await AsyncStorage.getItem('favoritePubs');
		let favorites = new Set();
		if (raw) {
			try {
				const parsed = JSON.parse(raw);
				// Expecting array of ids
				const arr = Array.isArray(parsed) ? parsed : coerceToPubArray(parsed);
				arr.forEach(id => { if (typeof id === 'string') favorites.add(id); });
			} catch (e) {
				console.warn('Corrupted favoritePubs; resetting', e);
				favorites = new Set();
			}
		}

		if (favorites.has(pubId)) favorites.delete(pubId);
		else favorites.add(pubId);

		await AsyncStorage.setItem('favoritePubs', JSON.stringify([...favorites]));
		return favorites;
	} catch (error) {
		console.error('togglePubFavorite error:', error);
		throw error;
	}
};