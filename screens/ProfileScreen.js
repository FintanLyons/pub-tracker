import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Animated, Alert, InteractionManager } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { fetchLondonPubs, fetchBoroughSummaries } from '../services/PubService';
import { getCurrentUserSecure } from '../services/SecureAuthService';
import { useAuth } from '../contexts/AuthContext';
import PintGlassIcon from '../components/PintGlassIcon';
import {
  cacheProfileStats,
  getCachedProfileStats,
  preloadProfileStats,
} from '../services/ProfileStatsCache';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const ACCENT_GREY = '#424242';

const SORT_MODES = {
  LOCATION: 'location',
  ALPHABETICAL: 'alphabetical',
  MOST_VISITED: 'most_visited',
  PERCENTAGE: 'percentage',
};

const VIEW_MODES = {
  AREA: 'area',
  BOROUGH: 'borough',
};

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { logout } = useAuth();
  const initialCachedStats = getCachedProfileStats();
  const [pubs, setPubs] = useState(initialCachedStats?.pubs || []);
  const [visitedCount, setVisitedCount] = useState(
    initialCachedStats?.visitedCount || 0
  );
  
  // Use totalCount from cached stats (set by primeProfileStatsFromPubs when all pubs loaded)
  const [totalCount, setTotalCount] = useState(initialCachedStats?.totalCount || 0);
  const [areaStatsRaw, setAreaStatsRaw] = useState(
    initialCachedStats?.areaStats || []
  );
  const [boroughStatsRaw, setBoroughStatsRaw] = useState(
    initialCachedStats?.boroughStats || []
  );
  const [currentLocation, setCurrentLocation] = useState(
    initialCachedStats?.location || null
  );
  const [sortMode, setSortMode] = useState(SORT_MODES.LOCATION);
  const [viewMode, setViewMode] = useState(VIEW_MODES.AREA);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const isFirstRender = useRef(true);
  const distanceCacheRef = useRef({
    areas: initialCachedStats?.areaDistanceMap
      ? { ...initialCachedStats.areaDistanceMap }
      : {},
    boroughs: initialCachedStats?.boroughDistanceMap
      ? { ...initialCachedStats.boroughDistanceMap }
      : {},
  });
  const hasCalculatedDistances = useRef(!!initialCachedStats?.location);
  const boroughSummariesCacheRef = useRef(null); // Cache borough summaries to avoid repeated fetches

  const handleAreaPress = useCallback((areaName) => {
    // Navigate to Map tab and pass the area name as a parameter
    navigation.navigate('Map', { areaToSearch: areaName });
  }, [navigation]);

  const handleBoroughPress = useCallback((boroughName) => {
    if (!boroughName || boroughName === 'Unknown') {
      return;
    }
    navigation.navigate('Map', { boroughToSearch: boroughName });
  }, [navigation]);

  // Calculate distance between two coordinates using Haversine formula (in km)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Get user's current location
  const getCurrentLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
    } catch (error) {
      console.warn('Location unavailable, continuing without distance sorting:', error?.message || error);
      return null;
    }
  }, []);

  const applyProfileStats = useCallback(
    (stats) => {
      if (!stats) {
        return;
      }

      setPubs(stats.pubs || []);
      setVisitedCount(stats.visitedCount || 0);
      
      // Use totalCount from cached stats (accurate total from all pubs)
      setTotalCount(stats.totalCount || 0);
      
      setAreaStatsRaw(
        Array.isArray(stats.areaStats) ? stats.areaStats : []
      );
      setBoroughStatsRaw(boroughStats);

      if (stats.location) {
        setCurrentLocation(stats.location);
        hasCalculatedDistances.current = true;
      }

      distanceCacheRef.current = {
        areas: stats.areaDistanceMap ? { ...stats.areaDistanceMap } : {},
        boroughs: stats.boroughDistanceMap
          ? { ...stats.boroughDistanceMap }
          : {},
      };
    },
    [distanceCacheRef, hasCalculatedDistances]
  );

  // Calculate total pub count from borough summaries (non-intensive)
  // Handles both boroughSummaries (with totalPubs) and boroughStats (with total)
  const calculateTotalCountFromBoroughs = useCallback((boroughData) => {
    if (!Array.isArray(boroughData) || boroughData.length === 0) {
      return 0;
    }
    // Sum up total pubs from all boroughs
    // Handle both structures: boroughSummaries use 'totalPubs', boroughStats use 'total'
    return boroughData.reduce((sum, borough) => {
      return sum + (borough.totalPubs || borough.total || 0);
    }, 0);
  }, []);

  const loadStats = useCallback(async () => {
    // Load current user
    const user = await getCurrentUserSecure();
    setCurrentUser(user);

    // Get cached stats for totalCount (total count doesn't change when visiting pubs)
    const cachedStats = getCachedProfileStats();

    // Always fetch fresh pubs to get latest visited status from AsyncStorage
    // This ensures that visiting a pub is immediately reflected when switching to ProfileScreen
    let allPubs = [];
    try {
      allPubs = await fetchLondonPubs();
    } catch (error) {
      console.error('Error fetching pubs in ProfileScreen:', error);
      // Fallback to cached data if fetch fails
      allPubs = cachedStats?.pubs || [];
    }
    
    setPubs(allPubs);
    
    // Use totalCount from cached stats (set by primeProfileStatsFromPubs when all pubs loaded)
    // This is the accurate total from all pubs in the database
    // Note: totalCount doesn't change when visiting pubs, so using cached value is safe
    const cachedTotalCount = cachedStats?.totalCount;
    if (typeof cachedTotalCount === 'number' && cachedTotalCount > 0) {
      setTotalCount(cachedTotalCount);
    } else {
      // Fallback: use allPubs length if cache doesn't have totalCount yet
      setTotalCount(allPubs.length);
    }
    
    const visited = allPubs.filter(p => p.isVisited);
    setVisitedCount(visited.length);

    // Get current location once (on first load) for distance calculations
    let userLocation = currentLocation;
    const shouldCalculateDistances = !hasCalculatedDistances.current;
    if (shouldCalculateDistances && !userLocation) {
      userLocation = await getCurrentLocation();
      if (userLocation) {
        setCurrentLocation(userLocation);
      }
    }

    // Calculate area breakdown
    const areaMap = {};
    const boroughMap = {};
    
    allPubs.forEach(pub => {
      const areaName =
        typeof pub.area === 'string' && pub.area.trim().length > 0
          ? pub.area.trim()
          : 'Unknown';
      const boroughName =
        typeof pub.borough === 'string' && pub.borough.trim().length > 0
          ? pub.borough.trim()
          : 'Unknown';

      if (!areaMap[areaName]) {
        areaMap[areaName] = {
          total: 0,
          visited: 0,
          borough: boroughName !== 'Unknown' ? boroughName : null,
          sumLat: 0,
          sumLon: 0,
          coordCount: 0,
        };
      }

      areaMap[areaName].total++;
      if (pub.isVisited) {
        areaMap[areaName].visited++;
      }
      if (!areaMap[areaName].borough && boroughName !== 'Unknown') {
        areaMap[areaName].borough = boroughName;
      }

      const lat = Number.parseFloat(pub.lat);
      const lon = Number.parseFloat(pub.lon);
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        areaMap[areaName].sumLat += lat;
        areaMap[areaName].sumLon += lon;
        areaMap[areaName].coordCount += 1;
      }

      if (!boroughMap[boroughName]) {
        boroughMap[boroughName] = {
          total: 0,
          visited: 0,
          sumLat: 0,
          sumLon: 0,
          coordCount: 0,
          areas: new Set(),
        };
      }

      boroughMap[boroughName].total += 1;
      if (pub.isVisited) {
        boroughMap[boroughName].visited += 1;
      }
      if (Number.isFinite(lat) && Number.isFinite(lon)) {
        boroughMap[boroughName].sumLat += lat;
        boroughMap[boroughName].sumLon += lon;
        boroughMap[boroughName].coordCount += 1;
      }
      if (areaName !== 'Unknown') {
        boroughMap[boroughName].areas.add(areaName);
      }
    });

    // Ensure distance caches exist
    if (!distanceCacheRef.current.areas) {
      distanceCacheRef.current.areas = {};
    }
    if (!distanceCacheRef.current.boroughs) {
      distanceCacheRef.current.boroughs = {};
    }

    // Create stats with distance if location is available
    const areaDistanceCache = distanceCacheRef.current.areas;
    const stats = Object.entries(areaMap)
      .map(([area, counts]) => {
        const { total, visited, borough, sumLat, sumLon, coordCount } = counts;
        const percentage = total > 0 ? Math.round((visited / total) * 100) : 0;
        let distance = null;

        if (Object.prototype.hasOwnProperty.call(areaDistanceCache, area)) {
          distance = areaDistanceCache[area];
        } else if (userLocation && coordCount > 0) {
          try {
            const centerLat = sumLat / coordCount;
            const centerLon = sumLon / coordCount;
            distance = calculateDistance(
              userLocation.latitude,
              userLocation.longitude,
              centerLat,
              centerLon
            );
          } catch (error) {
            console.warn(`Error calculating distance for area ${area}:`, error?.message || error);
            distance = null;
          }
          areaDistanceCache[area] = distance;
        }

        return {
          area,
          total,
          visited,
          borough: borough || null,
          percentage,
          distance,
        };
      });

    const areaStatsByName = stats.reduce((acc, stat) => {
      acc[stat.area] = stat;
      return acc;
    }, {});

    const boroughDistanceCache = distanceCacheRef.current.boroughs;
    const boroughStats = Object.entries(boroughMap).map(
      ([boroughName, boroughCounts]) => {
        const percentage =
          boroughCounts.total > 0
            ? Math.round((boroughCounts.visited / boroughCounts.total) * 100)
            : 0;

        let distance = null;
        if (Object.prototype.hasOwnProperty.call(boroughDistanceCache, boroughName)) {
          distance = boroughDistanceCache[boroughName];
        } else if (userLocation && boroughCounts.coordCount > 0) {
          try {
            const centerLat = boroughCounts.sumLat / boroughCounts.coordCount;
            const centerLon = boroughCounts.sumLon / boroughCounts.coordCount;
            distance = calculateDistance(
              userLocation.latitude,
              userLocation.longitude,
              centerLat,
              centerLon
            );
          } catch (error) {
            console.warn(
              `Error calculating distance for borough ${boroughName}:`,
              error?.message || error
            );
            distance = null;
          }
          boroughDistanceCache[boroughName] = distance;
        }

        const areaNames = Array.from(boroughCounts.areas);
        const totalAreas = areaNames.length;
        const completedAreas = areaNames.filter((areaName) => {
          const areaStat = areaStatsByName[areaName];
          if (!areaStat) {
            return false;
          }
          return areaStat.visited >= areaStat.total && areaStat.total > 0;
        }).length;

        return {
          borough: boroughName,
          total: boroughCounts.total,
          visited: boroughCounts.visited,
          percentage,
          distance,
          totalAreas,
          completedAreas,
        };
      }
    );

    if (shouldCalculateDistances && userLocation) {
      hasCalculatedDistances.current = true;
    }

    setAreaStatsRaw(stats);
    setBoroughStatsRaw(boroughStats);
    
    // Calculate accurate total count from borough stats (not just loaded pubs)
    const accurateTotalCount = calculateTotalCountFromBoroughs(boroughStats);
    
    cacheProfileStats({
      pubs: allPubs,
      totalCount: accurateTotalCount, // Use accurate total from borough stats
      visitedCount: visited.length,
      areaStats: stats,
      boroughStats,
      areaDistanceMap: { ...distanceCacheRef.current.areas },
      boroughDistanceMap: { ...distanceCacheRef.current.boroughs },
      location: userLocation || null,
    });
  }, [cacheProfileStats, currentLocation, distanceCacheRef, getCurrentLocation, hasCalculatedDistances, calculateTotalCountFromBoroughs]);

  // Update total count when cached stats update (from background pub loading)
  useEffect(() => {
    const cachedStats = getCachedProfileStats();
    if (cachedStats?.totalCount && cachedStats.totalCount !== totalCount) {
      setTotalCount(cachedStats.totalCount);
    }
  }, [totalCount]);

  useEffect(() => {
    let isActive = true;

    preloadProfileStats()
      .then((stats) => {
        if (isActive && stats) {
          applyProfileStats(stats);
        }
      })
      .catch((error) => {
        console.warn(
          'Unable to preload profile stats:',
          error?.message || error
        );
      });

    return () => {
      isActive = false;
    };
  }, [applyProfileStats]);

  useFocusEffect(
    useCallback(() => {
      // Show cached data immediately for instant display
      const cached = getCachedProfileStats();
      if (cached) {
        applyProfileStats(cached);
      }

      // Refresh in background (non-blocking)
      // Use InteractionManager to defer heavy computation
      InteractionManager.runAfterInteractions(() => {
        loadStats().catch((error) => {
          console.error('Error loading profile stats:', error);
        });
      });
    }, [applyProfileStats, loadStats])
  );

  const sortStats = useCallback(
    (stats, type) => {
      const sorted = [...stats];
      switch (sortMode) {
        case SORT_MODES.LOCATION:
          sorted.sort((a, b) => {
            const aHasDistance = a.distance !== null && a.distance !== undefined;
            const bHasDistance = b.distance !== null && b.distance !== undefined;
            if (aHasDistance && bHasDistance) {
              return a.distance - b.distance;
            }
            if (aHasDistance && !bHasDistance) return -1;
            if (!aHasDistance && bHasDistance) return 1;
            const aName = type === VIEW_MODES.AREA ? a.area : a.borough;
            const bName = type === VIEW_MODES.AREA ? b.area : b.borough;
            return aName.localeCompare(bName);
          });
          break;
        case SORT_MODES.ALPHABETICAL:
          sorted.sort((a, b) => {
            const aName = type === VIEW_MODES.AREA ? a.area : a.borough;
            const bName = type === VIEW_MODES.AREA ? b.area : b.borough;
            return aName.localeCompare(bName);
          });
          break;
        case SORT_MODES.MOST_VISITED:
          sorted.sort(
            (a, b) =>
              b.visited - a.visited ||
              (b.total || 0) - (a.total || 0)
          );
          break;
        case SORT_MODES.PERCENTAGE:
          sorted.sort(
            (a, b) =>
              b.percentage - a.percentage ||
              (b.visited || 0) - (a.visited || 0)
          );
          break;
        default:
          break;
      }
      return sorted;
    },
    [sortMode]
  );

  const areaStats = useMemo(() => {
    return sortStats(areaStatsRaw, VIEW_MODES.AREA);
  }, [areaStatsRaw, sortStats]);

  const boroughStats = useMemo(() => {
    return sortStats(boroughStatsRaw, VIEW_MODES.BOROUGH);
  }, [boroughStatsRaw, sortStats]);

  const hasPrevView = viewMode !== VIEW_MODES.AREA;
  const hasNextView = viewMode !== VIEW_MODES.BOROUGH;

  const handlePrevView = useCallback(() => {
    if (viewMode === VIEW_MODES.BOROUGH) {
      setViewMode(VIEW_MODES.AREA);
    }
  }, [viewMode]);

  const handleNextView = useCallback(() => {
    if (viewMode === VIEW_MODES.AREA) {
      setViewMode(VIEW_MODES.BOROUGH);
    }
  }, [viewMode]);

  // Animate modal content slide
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    
    if (showFilterModal) {
      // Reset to bottom position and animate up
      slideAnim.setValue(300);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      // Animate down when closing
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilterModal]);

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            // AuthContext will automatically update and show AuthScreen
          },
        },
      ]
    );
  };

  const progressPercentage = totalCount > 0 ? Math.round((visitedCount / totalCount) * 100) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.headerContainer}>
        <View style={styles.spacer} />
      <View style={styles.header}>
        <PintGlassIcon size={48} color={DARK_GREY} />
        <Text style={styles.title}>Pub Tracker</Text>
          {currentUser && (
            <Text style={styles.username}>@{currentUser.username}</Text>
          )}
        </View>
        {currentUser && (
          <TouchableOpacity 
            onPress={handleLogout}
            style={styles.logoutButtonHeader}
          >
            <MaterialCommunityIcons name="logout" size={24} color="#F44336" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.statsCard}>
        <View style={styles.mainStat}>
          <Text style={styles.visitedNumber}>{visitedCount}</Text>
          <Text style={styles.totalNumber}>/ {totalCount}</Text>
        </View>
        <Text style={styles.statLabel}>Pubs Visited</Text>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View 
              style={[styles.progressBarFill, { width: `${progressPercentage}%` }]} 
            />
          </View>
          <Text style={styles.progressText}>{progressPercentage}%</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionTitleContainer}>
          <TouchableOpacity
            onPress={handlePrevView}
            disabled={!hasPrevView}
            style={[
              styles.switchButton,
              styles.switchButtonLeft,
              !hasPrevView && styles.switchButtonDisabled,
            ]}
            activeOpacity={0.7}
          >
            <MaterialCommunityIcons
              name="chevron-left"
              size={24}
              color={hasPrevView ? DARK_GREY : '#D9D9D9'}
            />
          </TouchableOpacity>
          <Text style={[styles.sectionTitle, styles.sectionTitleLeft]} numberOfLines={1}>
            {viewMode === VIEW_MODES.AREA ? 'Sort by Area' : 'Sort by Borough'}
          </Text>
          <View style={styles.sectionRightControls}>
            <TouchableOpacity 
              onPress={() => setShowFilterModal(true)}
              style={styles.filterButton}
              activeOpacity={0.8}
            >
              <MaterialCommunityIcons name="filter-variant" size={20} color={DARK_GREY} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleNextView}
              disabled={!hasNextView}
              style={[
                styles.switchButton,
                styles.switchButtonRight,
                !hasNextView && styles.switchButtonDisabled,
              ]}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons
                name="chevron-right"
                size={24}
                color={hasNextView ? DARK_GREY : '#D9D9D9'}
              />
            </TouchableOpacity>
          </View>
        </View>
        {viewMode === VIEW_MODES.AREA ? (
          areaStats.length === 0 ? (
            <Text style={styles.emptyText}>No areas found</Text>
          ) : (
            areaStats.map((stat, index) => (
              <TouchableOpacity 
                key={`area-${index}`} 
                style={styles.areaCard}
                onPress={() => handleAreaPress(stat.area)}
                activeOpacity={0.7}
              >
                <View style={styles.areaHeader}>
                  <View style={styles.areaTitleRow}>
                    <Text style={styles.areaName} numberOfLines={1} ellipsizeMode="tail">
                      {stat.area}
                    </Text>
                    {stat.borough && (
                      <Text
                        style={styles.areaBoroughInline}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                      >
                        {stat.borough}
                      </Text>
                    )}
                  </View>
                  <Text style={styles.areaCount}>
                    {stat.visited} / {stat.total}
                  </Text>
                </View>
                <View style={styles.areaProgressBarContainer}>
                  <View style={styles.areaProgressBarBackground}>
                    <View 
                      style={[
                        styles.areaProgressBarFill, 
                        { width: `${stat.percentage}%` }
                      ]} 
                    />
                  </View>
                  <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
                </View>
              </TouchableOpacity>
            ))
          )
        ) : boroughStats.length === 0 ? (
          <Text style={styles.emptyText}>No boroughs found</Text>
        ) : (
          boroughStats.map((stat, index) => {
            const isInteractive = stat.borough && stat.borough !== 'Unknown';
            return (
              <TouchableOpacity 
                key={`borough-${index}`} 
                style={styles.areaCard}
                onPress={() => handleBoroughPress(stat.borough)}
                activeOpacity={isInteractive ? 0.7 : 1}
                disabled={!isInteractive}
              >
                <View style={styles.areaHeader}>
                  <Text style={styles.areaName}>{stat.borough}</Text>
                  <Text style={styles.areaCount}>
                    {stat.visited} / {stat.total}
                  </Text>
                </View>
                <View style={styles.areaProgressBarContainer}>
                  <View style={styles.areaProgressBarBackground}>
                    <View 
                      style={[
                        styles.areaProgressBarFill, 
                        { width: `${stat.percentage}%` }
                      ]} 
                    />
                  </View>
                  <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
                </View>
                <View style={styles.boroughAreaSummary}>
                  <MaterialCommunityIcons name="map-marker-radius" size={16} color={DARK_GREY} />
                  <Text style={styles.boroughAreaSummaryText}>
                    Areas complete: {stat.completedAreas} / {stat.totalAreas}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </View>

      <Modal
        visible={showFilterModal}
        animationType="none"
        transparent={true}
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowFilterModal(false)}
          />
          <Animated.View 
            style={[
              styles.modalContent,
              {
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sort by</Text>
              <TouchableOpacity 
                onPress={() => setShowFilterModal(false)}
                style={styles.modalCloseButton}
              >
                <MaterialCommunityIcons name="close" size={24} color={DARK_GREY} />
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.LOCATION && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.LOCATION);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.LOCATION && styles.filterOptionTextSelected
              ]}>
                Location (Distance)
              </Text>
              {sortMode === SORT_MODES.LOCATION && (
                <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.ALPHABETICAL && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.ALPHABETICAL);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.ALPHABETICAL && styles.filterOptionTextSelected
              ]}>
                Alphabetical
              </Text>
              {sortMode === SORT_MODES.ALPHABETICAL && (
                <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.MOST_VISITED && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.MOST_VISITED);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.MOST_VISITED && styles.filterOptionTextSelected
              ]}>
                Most Pubs Visited
              </Text>
              {sortMode === SORT_MODES.MOST_VISITED && (
                <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.PERCENTAGE && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.PERCENTAGE);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.PERCENTAGE && styles.filterOptionTextSelected
              ]}>
                Percentage Visited
              </Text>
              {sortMode === SORT_MODES.PERCENTAGE && (
                <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    padding: 20,
    paddingTop: 40,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  spacer: {
    width: 40,
  },
  header: {
    flex: 1,
    alignItems: 'center',
  },
  logoutButtonHeader: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: LIGHT_GREY,
    marginTop: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginTop: 12,
  },
  username: {
    fontSize: 16,
    color: MEDIUM_GREY,
    marginTop: 4,
  },
  statsCard: {
    backgroundColor: LIGHT_GREY,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  mainStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  visitedNumber: {
    fontSize: 56,
    fontWeight: 'bold',
    color: DARK_GREY,
  },
  totalNumber: {
    fontSize: 32,
    fontWeight: '600',
    color: MEDIUM_GREY,
    marginLeft: 4,
  },
  statLabel: {
    fontSize: 16,
    color: MEDIUM_GREY,
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressBarContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBarBackground: {
    flex: 1,
    height: 12,
    backgroundColor: '#E0E0E0',
    borderRadius: 6,
    overflow: 'hidden',
    marginRight: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: DARK_GREY,
    borderRadius: 6,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_GREY,
    minWidth: 50,
    textAlign: 'right',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_GREY,
    flex: 1,
    textAlign: 'center',
  },
  sectionTitleLeft: {
    textAlign: 'left',
  },
  sectionRightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  switchButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  switchButtonLeft: {
    marginRight: 12,
  },
  switchButtonRight: {
    marginLeft: 12,
  },
  switchButtonDisabled: {
    backgroundColor: '#F5F5F5',
    borderColor: '#F5F5F5',
  },
  filterButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: LIGHT_GREY,
    marginRight: 12,
  },
  emptyText: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textAlign: 'center',
    paddingVertical: 20,
  },
  areaCard: {
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  areaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  areaTitleRow: {
    flex: 1,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  areaName: {
    fontSize: 17,
    fontWeight: '600',
    color: DARK_GREY,
    flexShrink: 1,
  },
  areaBoroughInline: {
    marginLeft: 6,
    fontSize: 12,
    fontWeight: '600',
    color: ACCENT_GREY,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  areaCount: {
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT_GREY,
  },
  areaProgressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  areaProgressBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 8,
  },
  areaProgressBarFill: {
    height: '100%',
    backgroundColor: DARK_GREY,
    borderRadius: 4,
  },
  areaPercentage: {
    fontSize: 14,
    fontWeight: '600',
    color: MEDIUM_GREY,
    minWidth: 45,
    textAlign: 'right',
  },
  boroughAreaSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  boroughAreaSummaryText: {
    marginLeft: 6,
    fontSize: 14,
    color: DARK_GREY,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GREY,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_GREY,
  },
  modalCloseButton: {
    padding: 4,
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GREY,
  },
  filterOptionSelected: {
    backgroundColor: LIGHT_GREY,
  },
  filterOptionText: {
    fontSize: 16,
    color: DARK_GREY,
  },
  filterOptionTextSelected: {
    fontWeight: '600',
  },
});