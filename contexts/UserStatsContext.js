import React, { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';
import { supabase } from '../config/supabase';
import { getPostcodeDistrictDisplayName } from '../utils/postcodeDistrictDisplayNames';
import { SUPPORTED_POSTCODE_AREAS } from '../constants/londonAreas';
import { getDrinkStats } from '../services/ReviewService';
import { createCoalescedRunner } from '../utils/coalescedRunner';

const EMPTY_DRINK_STATS = { total: 0, byDistrict: {}, byPostcodeArea: {} };

const UserStatsContext = createContext(null);

export const UserStatsProvider = ({ userId, children }) => {
	const [districtStats, setDistrictStats] = useState([]);
	const [postcodeAreaStats, setPostcodeAreaStats] = useState([]);
	const [totalVisited, setTotalVisited] = useState(0);
	const [totalPubs, setTotalPubs] = useState(0);
	const [achievements, setAchievements] = useState(null);
	const [drinkStats, setDrinkStats] = useState(EMPTY_DRINK_STATS);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);
	const [lastUpdated, setLastUpdated] = useState(null);
	const fetchUserStatsOnce = useCallback(async () => {
		setError(null);
		try {
			const [districtResult, areaResult, achievementsResult, drinkStatsResult] = await Promise.all([
				supabase.rpc('get_area_stats', { p_user_id: userId }),
				supabase.rpc('get_borough_stats', { p_user_id: userId }),
				supabase.rpc('get_achievements', { p_user_id: userId }),
				getDrinkStats(userId).catch((err) => {
					console.error('Error loading drink stats:', err);
					return EMPTY_DRINK_STATS;
				}),
			]);

			if (districtResult.error) throw districtResult.error;
			if (areaResult.error) throw areaResult.error;
			if (achievementsResult.error) throw achievementsResult.error;

			const rawDistricts = districtResult.data || [];
			const rawAreas = areaResult.data || [];

		const mappedDistricts = rawDistricts.map((row) => ({
			district: row.district,
			districtDisplayName: getPostcodeDistrictDisplayName(row.district),
			postcodeArea: row.postcode_area || null,
			total: Number(row.total),
			visited: Number(row.visited),
			percentage: row.percentage,
			centerLat: row.center_lat ?? null,
			centerLon: row.center_lon ?? null,
		})).filter((d) => d.postcodeArea && SUPPORTED_POSTCODE_AREAS.has(d.postcodeArea));

		const mappedPostcodeAreas = rawAreas.map((row) => ({
			postcodeArea: row.postcode_area,
			totalPubs: Number(row.total_pubs),
			visitedPubs: Number(row.visited_pubs),
			percentage: row.percentage,
			totalDistricts: Number(row.total_districts),
			completedDistricts: Number(row.completed_districts),
			centerLat: row.center_lat ?? null,
			centerLon: row.center_lon ?? null,
		})).filter((a) => a.postcodeArea && SUPPORTED_POSTCODE_AREAS.has(a.postcodeArea));

		// Pubs visited comes from user_stats (via get_achievements) so Profile and
		// Leaderboard always show the same number.
		const totalVisitedCount = Number(achievementsResult.data?.pubsVisited)
			|| mappedDistricts.reduce((sum, s) => sum + (s.visited || 0), 0);
		const totalPubsCount = mappedDistricts.reduce((sum, s) => sum + (s.total || 0), 0);

		setDistrictStats(mappedDistricts);
		setPostcodeAreaStats(mappedPostcodeAreas);
			setTotalVisited(totalVisitedCount);
			setTotalPubs(totalPubsCount);
			setAchievements(achievementsResult.data || null);
			setDrinkStats(drinkStatsResult || EMPTY_DRINK_STATS);
			setLastUpdated(Date.now());
		} catch (err) {
			console.error('Error loading user stats:', err);
			setError(err);
		}
	}, [userId]);

	/**
	 * Refresh all stats. Calls made while a refresh is running are merged into a single
	 * follow-up refresh (never dropped); the returned promise settles after it.
	 */
	const runStatsRefresh = useMemo(
		() => createCoalescedRunner(fetchUserStatsOnce),
		[fetchUserStatsOnce],
	);

	const loadUserStats = useCallback(() => {
		if (!userId) return Promise.resolve();
		setLoading(true);
		return runStatsRefresh().finally(() => setLoading(false));
	}, [userId, runStatsRefresh]);

	useEffect(() => {
		loadUserStats();
	}, [loadUserStats]);

	return (
		<UserStatsContext.Provider
			value={{
				districtStats,
				postcodeAreaStats,
				totalVisited,
				totalPubs,
				achievements,
				drinkStats,
				loading,
				error,
				lastUpdated,
				refreshUserStats: loadUserStats,
			}}
		>
			{children}
		</UserStatsContext.Provider>
	);
};

export const useUserStats = () => {
	const ctx = useContext(UserStatsContext);
	if (!ctx) {
		throw new Error('useUserStats must be used within a UserStatsProvider');
	}
	return ctx;
};
