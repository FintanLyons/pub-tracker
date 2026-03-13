import React, { createContext, useCallback, useContext, useState, useEffect, useRef } from 'react';
import { supabase } from '../config/supabase';

const UserStatsContext = createContext(null);

export const UserStatsProvider = ({ userId, children }) => {
	const [areaStats, setAreaStats] = useState([]);
	const [boroughStats, setBoroughStats] = useState([]);
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
			const [areaResult, boroughResult, achievementsResult] = await Promise.all([
				supabase.rpc('get_area_stats', { p_user_id: userId }),
				supabase.rpc('get_borough_stats', { p_user_id: userId }),
				supabase.rpc('get_achievements', { p_user_id: userId }),
			]);

			if (areaResult.error) throw areaResult.error;
			if (boroughResult.error) throw boroughResult.error;
			if (achievementsResult.error) throw achievementsResult.error;

			const rawAreas = areaResult.data || [];
			const rawBoroughs = boroughResult.data || [];

			const mappedAreas = rawAreas.map((row) => ({
				area: row.area,
				borough: row.borough || null,
				total: Number(row.total),
				visited: Number(row.visited),
				percentage: row.percentage,
				centerLat: row.center_lat ?? null,
				centerLon: row.center_lon ?? null,
			}));

			const mappedBoroughs = rawBoroughs.map((row) => ({
				borough: row.borough,
				totalPubs: Number(row.total_pubs),
				visitedPubs: Number(row.visited_pubs),
				percentage: row.percentage,
				totalAreas: Number(row.total_areas),
				completedAreas: Number(row.completed_areas),
				centerLat: row.center_lat ?? null,
				centerLon: row.center_lon ?? null,
			}));

			const totalVisitedCount = mappedAreas.reduce((sum, s) => sum + (s.visited || 0), 0);
			const totalPubsCount = mappedAreas.reduce((sum, s) => sum + (s.total || 0), 0);

			setAreaStats(mappedAreas);
			setBoroughStats(mappedBoroughs);
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
				areaStats,
				boroughStats,
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
