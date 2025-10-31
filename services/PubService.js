import AsyncStorage from '@react-native-async-storage/async-storage';

const MOCK_PUBS = [
	{
		id: '1',
		name: 'The Red Lion',
		lat: 51.5074,
		lon: -0.1278,
		address: '48 Parliament Street, London',
		features: ['Beer Garden', 'Dog Friendly', 'Live Music'],
		photoUrl: 'https://placekitten.com/400/300',
	},
	{
		id: '2',
		name: 'The Crown',
		lat: 51.5138,
		lon: -0.1289,
		address: '43 Monmouth Street, London',
		features: ['Food Served', 'Historic Pub', 'Real Ale'],
		photoUrl: 'https://placekitten.com/401/300',
	},
];

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

		// Load base pubs (mock). In a real app, fetch from an API here.
		const pubs = MOCK_PUBS.map(pub => ({
			...pub,
			isVisited: visitedSet.has(pub.id),
		}));

		return pubs;
	} catch (error) {
		console.error('fetchLondonPubs error:', error);
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