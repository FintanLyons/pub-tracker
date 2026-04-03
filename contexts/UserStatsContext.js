import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import { getPostcodeDistrictDisplayName } from '../utils/postcodeDistrictDisplayNames';
import { CORE_LONDON_AREAS } from '../constants/londonAreas';
import { getDrinkStats } from '../services/ReviewService';

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
	const loadingRef = useRef(false);

	const loadUserStats = useCallback(async () => {
		if (!userId || loadingRef.current) return;
		loadingRef.current = true;
		setLoading(true);
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
		})).filter((d) => d.postcodeArea && CORE_LONDON_AREAS.has(d.postcodeArea));

		const mappedPostcodeAreas = rawAreas.map((row) => ({
			postcodeArea: row.postcode_area,
			totalPubs: Number(row.total_pubs),
			visitedPubs: Number(row.visited_pubs),
			percentage: row.percentage,
			totalDistricts: Number(row.total_districts),
			completedDistricts: Number(row.completed_districts),
			centerLat: row.center_lat ?? null,
			centerLon: row.center_lon ?? null,
		})).filter((a) => a.postcodeArea && CORE_LONDON_AREAS.has(a.postcodeArea));

		const totalVisitedCount = mappedDistricts.reduce((sum, s) => sum + (s.visited || 0), 0);
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
		} finally {
			loadingRef.current = false;
			setLoading(false);
		}
	}, [userId]);

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
