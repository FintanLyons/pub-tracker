import AsyncStorage from '@react-native-async-storage/async-storage';
import MOCK_PUBS from '../pubs_data_short.js';
import { getSupabaseUrl, getSupabaseHeaders } from '../config/supabase';

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

export const fetchLondonPubs = async () => {
	try {
		// Get visited pubs from local storage
		const rawVisited = await AsyncStorage.getItem('visitedPubs');
		const visitedSet = new Set();
		if (rawVisited) {
			try {
				const parsed = JSON.parse(rawVisited);
				const arr = coerceToPubArray(parsed) || (Array.isArray(parsed) ? parsed : []);
				// If parsed is array of ids, use them; otherwise ignore
				if (Array.isArray(parsed) && parsed.every(i => typeof i === 'string')) {
					parsed.forEach(id => visitedSet.add(id));
				} else if (Array.isArray(arr) && arr.every(x => typeof x === 'string')) {
					arr.forEach(id => visitedSet.add(id));
				}
			} catch (e) {
				console.warn('visitedPubs in AsyncStorage is malformed, clearing it', e);
				await AsyncStorage.removeItem('visitedPubs');
			}
		}

		// Try to fetch from Supabase
		const supabaseUrl = getSupabaseUrl();
		const headers = getSupabaseHeaders();
		
		if (supabaseUrl && headers) {
			try {
				// Fetch pubs with their features and achievements
				const pubsResponse = await fetch(
					`${supabaseUrl}/pubs?select=*`,
					{ headers }
				);
				
				if (!pubsResponse.ok) {
					throw new Error(`Supabase error: ${pubsResponse.status}`);
				}
				
				const pubs = await pubsResponse.json();
				
				// Fetch features for all pubs
				const featuresResponse = await fetch(
					`${supabaseUrl}/pub_features?select=pub_id,feature`,
					{ headers }
				);
				const allFeatures = await featuresResponse.json();
				
				// Fetch achievements for all pubs
				const achievementsResponse = await fetch(
					`${supabaseUrl}/pub_achievements?select=pub_id,achievement`,
					{ headers }
				);
				const allAchievements = await achievementsResponse.json();
				
				// Group features and achievements by pub_id
				const featuresMap = {};
				allFeatures.forEach(f => {
					if (!featuresMap[f.pub_id]) featuresMap[f.pub_id] = [];
					featuresMap[f.pub_id].push(f.feature);
				});
				
				const achievementsMap = {};
				allAchievements.forEach(a => {
					if (!achievementsMap[a.pub_id]) achievementsMap[a.pub_id] = [];
					achievementsMap[a.pub_id].push(a.achievement);
				});
				
				// Combine and format pubs
				const formattedPubs = pubs.map(pub => ({
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
					ownership: pub.ownership,
					photoUrl: pub.photo_url, // Map photo_url to photoUrl for compatibility
					points: pub.points || 10,
					features: featuresMap[pub.id] || [],
					achievements: achievementsMap[pub.id] || [],
					isVisited: visitedSet.has(pub.id),
				}));
				
				console.log(`✅ Fetched ${formattedPubs.length} pubs from Supabase`);
				return formattedPubs;
				
			} catch (supabaseError) {
				console.error('Supabase fetch error:', supabaseError);
				console.log('⚠️  Falling back to mock data');
				// Fall through to mock data fallback
			}
		}
		
		// Fallback to mock data if Supabase is not configured or fails
		console.log('📦 Using mock data (Supabase not configured or unavailable)');
		const pubs = MOCK_PUBS.map(pub => ({
			...pub,
			isVisited: visitedSet.has(pub.id),
		}));

		return pubs;
	} catch (error) {
		console.error('fetchLondonPubs error:', error);
		// Final fallback
		return MOCK_PUBS.map(pub => ({ ...pub, isVisited: false }));
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