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

// ---------------------------------------------------------------------------
// Server-side visited / favorite tracking
// ---------------------------------------------------------------------------

let _visitedSet = null;
let _favoritesSet = null;
let _cacheUserId = null;

const getCurrentSession = async () => {
	try {
		const sessionJson = await AsyncStorage.getItem('supabase_session');
		if (!sessionJson) return null;
		const session = JSON.parse(sessionJson);
		if (!session?.access_token) return null;
		const userJson = await AsyncStorage.getItem('currentUser');
		const user = userJson ? JSON.parse(userJson) : null;
		return {
			accessToken: session.access_token,
			userId: user?.id || session?.user?.id || null,
		};
	} catch {
		return null;
	}
};

const fetchServerIdSet = async (table, userId, accessToken) => {
	const supabaseUrl = getSupabaseUrl();
	if (!supabaseUrl) return null;
	const headers = getSupabaseHeaders(accessToken);
	if (!headers) return null;
	const response = await fetch(
		`${supabaseUrl}/${table}?user_id=eq.${userId}&select=pub_id`,
		{ headers },
	);
	if (!response.ok) return null;
	const rows = await response.json();
	return new Set(rows.map((r) => r.pub_id));
};

const loadVisitedAndFavoriteSets = async () => {
	const session = await getCurrentSession();

	if (session?.userId && session?.accessToken) {
		if (_cacheUserId === session.userId && _visitedSet && _favoritesSet) {
			return { visitedSet: _visitedSet, favoritesSet: _favoritesSet };
		}
		try {
			const [visited, favorites] = await Promise.all([
				fetchServerIdSet('visited_pubs', session.userId, session.accessToken),
				fetchServerIdSet('favorite_pubs', session.userId, session.accessToken),
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
		if (!session?.userId || !session?.accessToken) return;

		const supabaseUrl = getSupabaseUrl();
		if (!supabaseUrl) return;

		const headers = getSupabaseHeaders(session.accessToken);
		const [visitedSet, favoritesSet] = await Promise.all([
			loadIdSet('visitedPubs'),
			loadIdSet('favoritePubs'),
		]);

		if (visitedSet.size > 0) {
			const rows = [...visitedSet].map((pubId) => ({
				user_id: session.userId,
				pub_id: pubId,
			}));
			await fetch(
				`${supabaseUrl}/visited_pubs?on_conflict=user_id,pub_id`,
				{
					method: 'POST',
					headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
					body: JSON.stringify(rows),
				},
			);
		}

		if (favoritesSet.size > 0) {
			const rows = [...favoritesSet].map((pubId) => ({
				user_id: session.userId,
				pub_id: pubId,
			}));
			await fetch(
				`${supabaseUrl}/favorite_pubs?on_conflict=user_id,pub_id`,
				{
					method: 'POST',
					headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
					body: JSON.stringify(rows),
				},
			);
		}

		await AsyncStorage.setItem('server_migration_done', 'true');
		clearVisitedFavoriteCache();
		console.log(`Migration complete: ${visitedSet.size} visits, ${favoritesSet.size} favorites`);
	} catch (error) {
		console.error('Migration error (will retry next launch):', error);
	}
};

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

		const { visitedSet, favoritesSet } = await loadVisitedAndFavoriteSets();

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

				const baseQueryString = supabaseQueryParams.join('&');

				// Fetch all pubs using pagination
				// Use smaller limit on mobile to avoid OOM errors
				const limit = 500; // Reduced from 1000 to avoid memory issues on Android
				let allPubs = [];
				let offset = 0;
				let hasMore = true;

				while (hasMore) {
					const queryString = `${baseQueryString}&limit=${limit}&offset=${offset}`;
					
					try {
						const pubsResponse = await fetch(`${supabaseUrl}/pubs_all?${queryString}`, {
							headers
						});
						
						if (!pubsResponse.ok) {
							throw new Error(`Supabase error: ${pubsResponse.status}`);
						}
						
						// Parse response with error handling for large responses
						const responseText = await pubsResponse.text();
						if (!responseText || responseText.length === 0) {
							hasMore = false;
							break;
						}
						
						let batch;
						try {
							batch = JSON.parse(responseText);
						} catch (parseError) {
							console.error('Failed to parse response:', parseError);
							console.log('Response length:', responseText.length);
							throw new Error('Failed to parse Supabase response - response too large');
						}
						
						if (Array.isArray(batch) && batch.length > 0) {
							allPubs = allPubs.concat(batch);
							offset += batch.length;
							hasMore = batch.length === limit;
							
							// Limit total pubs to prevent OOM (safety check)
							if (allPubs.length > 5000) {
								console.warn('Reached safety limit of 5000 pubs, stopping pagination');
								hasMore = false;
							}
						} else {
							hasMore = false;
						}
					} catch (fetchError) {
						// Handle OOM or other memory errors
						if (fetchError.message && (
							fetchError.message.includes('allocation') ||
							fetchError.message.includes('OOM') ||
							fetchError.message.includes('memory') ||
							fetchError.message.includes('too large')
						)) {
							console.error('Memory error fetching pubs:', fetchError.message);
							// Return what we have so far instead of failing completely
							if (allPubs.length > 0) {
								console.warn(`Returning ${allPubs.length} pubs before memory error`);
								break;
							}
							throw new Error('Response too large - try filtering by bounds or borough');
						}
						throw fetchError;
					}
				}
				
				const pubs = allPubs;
				
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
		const { visitedSet } = await loadVisitedAndFavoriteSets();
		const supabaseUrl = getSupabaseUrl();
		const headers = getSupabaseHeaders();

		if (supabaseUrl && headers) {
			try {
				const baseQueryParts = ['select=id,borough,lat,lon', 'borough=not.is.null'];
				const baseQueryString = baseQueryParts.join('&');

				// Fetch all pubs using pagination with smaller limit to avoid OOM
				let allRows = [];
				let offset = 0;
				const limit = 500; // Reduced from 1000 to avoid memory issues
				let hasMore = true;

				while (hasMore) {
					const queryString = `${baseQueryString}&limit=${limit}&offset=${offset}`;
					
					try {
						const response = await fetch(`${supabaseUrl}/pubs_all?${queryString}`, {
							headers,
						});

						if (!response.ok) {
							throw new Error(`Supabase borough summary error: ${response.status}`);
						}

						// Parse response with error handling for large responses
						const responseText = await response.text();
						if (!responseText || responseText.length === 0) {
							hasMore = false;
							break;
						}
						
						let batch;
						try {
							batch = JSON.parse(responseText);
						} catch (parseError) {
							console.error('Failed to parse borough summary response:', parseError);
							throw new Error('Failed to parse Supabase response - response too large');
						}
						
						if (Array.isArray(batch) && batch.length > 0) {
							allRows = allRows.concat(batch);
							offset += batch.length;
							hasMore = batch.length === limit;
							
							// Safety limit
							if (allRows.length > 5000) {
								console.warn('Reached safety limit for borough summaries');
								hasMore = false;
							}
						} else {
							hasMore = false;
						}
					} catch (fetchError) {
						// Handle OOM or other memory errors
						if (fetchError.message && (
							fetchError.message.includes('allocation') ||
							fetchError.message.includes('OOM') ||
							fetchError.message.includes('memory') ||
							fetchError.message.includes('too large')
						)) {
							console.error('Memory error fetching borough summaries:', fetchError.message);
							// Return what we have so far
							if (allRows.length > 0) {
								console.warn(`Returning ${allRows.length} rows before memory error`);
								break;
							}
							throw fetchError;
						}
						throw fetchError;
					}
				}

				const rows = allRows;
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

	const session = await getCurrentSession();
	const supabaseUrl = getSupabaseUrl();
	const hasServer = !!(session?.userId && session?.accessToken && supabaseUrl);

	const isCurrentlyVisited = _visitedSet
		? _visitedSet.has(pubId)
		: (await loadIdSet('visitedPubs')).has(pubId);

	if (hasServer) {
		const headers = getSupabaseHeaders(session.accessToken);
		if (isCurrentlyVisited) {
			const resp = await fetch(
				`${supabaseUrl}/visited_pubs?user_id=eq.${session.userId}&pub_id=eq.${pubId}`,
				{ method: 'DELETE', headers },
			);
			if (!resp.ok) throw new Error(`Failed to remove visit: ${resp.status}`);
		} else {
			const resp = await fetch(`${supabaseUrl}/visited_pubs`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ user_id: session.userId, pub_id: pubId }),
			});
			if (!resp.ok) throw new Error(`Failed to record visit: ${resp.status}`);
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
	const supabaseUrl = getSupabaseUrl();
	const hasServer = !!(session?.userId && session?.accessToken && supabaseUrl);

	const isCurrentlyFavorite = _favoritesSet
		? _favoritesSet.has(pubId)
		: (await loadIdSet('favoritePubs')).has(pubId);

	if (hasServer) {
		const headers = getSupabaseHeaders(session.accessToken);
		if (isCurrentlyFavorite) {
			const resp = await fetch(
				`${supabaseUrl}/favorite_pubs?user_id=eq.${session.userId}&pub_id=eq.${pubId}`,
				{ method: 'DELETE', headers },
			);
			if (!resp.ok) throw new Error(`Failed to remove favorite: ${resp.status}`);
		} else {
			const resp = await fetch(`${supabaseUrl}/favorite_pubs`, {
				method: 'POST',
				headers,
				body: JSON.stringify({ user_id: session.userId, pub_id: pubId }),
			});
			if (!resp.ok) throw new Error(`Failed to record favorite: ${resp.status}`);
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