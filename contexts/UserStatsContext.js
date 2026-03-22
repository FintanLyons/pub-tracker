import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';
import { getPostcodeDistrictDisplayName } from '../utils/postcodeDistrictDisplayNames';

const UserStatsContext = createContext(null);

export const UserStatsProvider = ({ userId, children }) => {
	const [districtStats, setDistrictStats] = useState([]);
	const [postcodeAreaStats, setPostcodeAreaStats] = useState([]);
	const [totalVisited, setTotalVisited] = useState(0);
	const [totalPubs, setTotalPubs] = useState(0);
	const [achievements, setAchievements] = useState(null);
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
			const [districtResult, areaResult, achievementsResult] = await Promise.all([
				supabase.rpc('get_area_stats', { p_user_id: userId }),
				supabase.rpc('get_borough_stats', { p_user_id: userId }),
				supabase.rpc('get_achievements', { p_user_id: userId }),
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
			}));

			const mappedPostcodeAreas = rawAreas.map((row) => ({
				postcodeArea: row.postcode_area,
				totalPubs: Number(row.total_pubs),
				visitedPubs: Number(row.visited_pubs),
				percentage: row.percentage,
				totalDistricts: Number(row.total_districts),
				completedDistricts: Number(row.completed_districts),
				centerLat: row.center_lat ?? null,
				centerLon: row.center_lon ?? null,
			}));

			const totalVisitedCount = mappedDistricts.reduce((sum, s) => sum + (s.visited || 0), 0);
			const totalPubsCount = mappedDistricts.reduce((sum, s) => sum + (s.total || 0), 0);

			setDistrictStats(mappedDistricts);
			setPostcodeAreaStats(mappedPostcodeAreas);
			setTotalVisited(totalVisitedCount);
			setTotalPubs(totalPubsCount);
			setAchievements(achievementsResult.data || null);
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
