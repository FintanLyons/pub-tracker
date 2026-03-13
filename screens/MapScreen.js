import React, { useEffect, useState, useRef, useCallback, useContext, useMemo } from 'react';
import {
  View,
  Text,
  Dimensions,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useFocusEffect, useNavigation } from '@react-navigation/native';
import MapView, { Marker } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  togglePubVisited,
  togglePubFavorite,
} from '../services/PubService';
import { submitMissingPubReport } from '../services/ReportService';
import AreaIcon from '../components/AreaIcon';
import SearchBar from '../components/SearchBar';
import SearchSuggestions from '../components/SearchSuggestions';
import DraggablePubCard from '../components/DraggablePubCard';
import ReportMissingPubModal from '../components/ReportMissingPubModal';
import FilterScreen from './FilterScreen';
import { LoadingContext } from '../contexts/LoadingContext';
import {
  LONDON_REGION,
  MARKER_MODES,
  BOROUGH_EXIT_DELTA,
  AREA_ENTER_DELTA,
  AREA_EXIT_DELTA,
  BOROUGH_LIMIT,
  COLORS,
} from './map/constants';
import {
  distanceBetween,
  getAreaCenter,
  interpolateColor,
} from './map/utils';
import { customMapStyle } from './map/mapStyle';
import { PubMarker } from './map/markers';
import { styles } from './map/mapStyles';
import { useAreaStats } from './map/hooks/useAreaStats';
import { useNearestAreaKeys } from './map/hooks/useNearestAreas';
import { useViewportPubs } from './map/hooks/useViewportPubs';
import { useMapRegion } from './map/hooks/useMapRegion';
import { useLocation } from './map/hooks/useLocation';
import { useFilterState } from './map/hooks/useFilterState';
import { useImageSource } from './map/hooks/useImageSource';
import { usePreloading } from './map/hooks/usePreloading';

const AMBER = COLORS.amber;
const DARK_CHARCOAL = COLORS.charcoal;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { isLocationLoaded, setIsLocationLoaded, setIsInitialPubsLoaded } = useContext(LoadingContext);
  const mapRef = useRef(null);

  // --- Core state ---
  const [allPubs, setAllPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedArea, setSelectedArea] = useState(null);
  const [focusedBorough, setFocusedBorough] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [boroughSummaries, setBoroughSummaries] = useState([]);
  const [isLoadingBoroughs, setIsLoadingBoroughs] = useState(true);
  const [activeBoroughs, setActiveBoroughs] = useState([]);
  const [shouldTrackBoroughViews, setShouldTrackBoroughViews] = useState(true);
  const [isMissingPubModalVisible, setIsMissingPubModalVisible] = useState(false);
  const [isSubmittingMissingPub, setIsSubmittingMissingPub] = useState(false);
  const [missingPubError, setMissingPubError] = useState(null);
  const [isMissingPubSuccessVisible, setIsMissingPubSuccessVisible] = useState(false);
  const clearedAreaRef = useRef(null);
  const clearedBoroughRef = useRef(null);
  const processedAreaRef = useRef(null);
  const processedBoroughRef = useRef(null);
  const initialPubsLoadedRef = useRef(false);

  // --- Extracted hooks ---
  const { mapRegion, markerMode, lastCommittedRegionRef, commitMapRegion, regionsAreApproximatelyEqual } = useMapRegion();
  const { currentLocation, heading, keyboardHeight, keyboardTop, isNavigatingRef, regionChangeTimeoutRef, handleCurrentLocation } = useLocation(commitMapRegion, mapRef, setIsLocationLoaded);
  const getImageSource = useImageSource();
  const {
    selectedFeatures, selectedOwnerships, yearRange,
    showOnlyFavorites, showOnlyAchievements, showFilterScreen,
    allFeatures, allOwnerships, availableYearRange,
    handleFilterApply, handleFilterPress, handleFilterClose,
  } = useFilterState(allPubs);
  const { areaStatsMap, allAreas, calculateAreaStats } = useAreaStats(allPubs);

  // --- Layout ---
  const screenHeight = Dimensions.get('window').height;
  const cardHeight = screenHeight * 0.33;
  const floatingButtonBottom = useMemo(
    () => insets.bottom - 24 + (selectedPub ? cardHeight - 24 : 0),
    [insets.bottom, selectedPub, cardHeight],
  );

  // --- Pub merging ---
  const mergePubs = useCallback((incomingPubs) => {
    if (!Array.isArray(incomingPubs) || incomingPubs.length === 0) return;
    setAllPubs((current) => {
      if (!Array.isArray(current) || current.length === 0) return incomingPubs;
      const pubMap = new Map(current.map((p) => [p.id, p]));
      let didChange = false;
      incomingPubs.forEach((pub) => {
        if (!pub?.id) return;
        const existing = pubMap.get(pub.id);
        if (!existing) { pubMap.set(pub.id, pub); didChange = true; return; }
        if (Object.keys(pub).some((k) => existing[k] !== pub[k])) {
          pubMap.set(pub.id, { ...existing, ...pub });
          didChange = true;
        }
      });
      return didChange ? Array.from(pubMap.values()) : current;
    });
  }, []);

  // --- Viewport pub loading ---
  const handleViewportPubsLoaded = useCallback((pubs) => {
    if (Array.isArray(pubs) && pubs.length > 0) {
      mergePubs(pubs);
      if (!initialPubsLoadedRef.current && setIsInitialPubsLoaded) {
        initialPubsLoadedRef.current = true;
        setIsInitialPubsLoaded(true);
      }
    }
  }, [mergePubs, setIsInitialPubsLoaded]);

  const { loadPubsForRegion: loadPubsForViewportRegion, isLoading: isLoadingViewportPubs } = useViewportPubs(
    mapRegion || lastCommittedRegionRef.current || null,
    handleViewportPubsLoaded,
  );

  useEffect(() => {
    if (!isLoadingViewportPubs && !initialPubsLoadedRef.current && setIsInitialPubsLoaded) {
      const timer = setTimeout(() => {
        if (!initialPubsLoadedRef.current) {
          initialPubsLoadedRef.current = true;
          setIsInitialPubsLoaded(true);
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isLoadingViewportPubs, setIsInitialPubsLoaded]);

  // --- Preloading (boroughs, all pubs, leaderboard) ---
  usePreloading(setBoroughSummaries, setIsLoadingBoroughs);

  // --- Borough tracking ---
  useEffect(() => {
    if (boroughSummaries.length === 0) { setShouldTrackBoroughViews(true); return; }
    setShouldTrackBoroughViews(true);
    const timer = setTimeout(() => setShouldTrackBoroughViews(false), 600);
    return () => clearTimeout(timer);
  }, [boroughSummaries]);

  useEffect(() => {
    const region = mapRegion || lastCommittedRegionRef.current;
    if (!region || !Array.isArray(boroughSummaries) || boroughSummaries.length === 0) {
      setActiveBoroughs(focusedBorough ? [focusedBorough] : []);
      return;
    }
    const center = { latitude: region.latitude, longitude: region.longitude };
    const nearest = boroughSummaries
      .filter((s) => s?.center && Number.isFinite(s.center.latitude) && Number.isFinite(s.center.longitude))
      .map((s) => ({ borough: s.borough, distance: distanceBetween(s.center, center) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, BOROUGH_LIMIT)
      .map((item) => item.borough);
    if (focusedBorough && nearest.indexOf(focusedBorough) === -1) nearest.unshift(focusedBorough);
    setActiveBoroughs(nearest);
  }, [mapRegion, boroughSummaries, focusedBorough]);

  const allBoroughNames = useMemo(() => {
    const set = new Set();
    if (Array.isArray(boroughSummaries)) boroughSummaries.forEach((s) => { if (s?.borough) set.add(s.borough); });
    allPubs.forEach((p) => { if (typeof p?.borough === 'string' && p.borough.trim().length > 0) set.add(p.borough.trim()); });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [boroughSummaries, allPubs]);

  const nearestAreaKeys = useNearestAreaKeys(mapRegion, areaStatsMap, activeBoroughs, lastCommittedRegionRef);

  // --- Filtered pubs ---
  const filteredPubs = useMemo(() => {
    if (!allPubs || allPubs.length === 0) return [];
    const basePubs = allPubs.filter((pub) => {
      const areaName = pub.area ? pub.area.trim() : '';
      if (!areaName) return false;
      const key = areaName.toLowerCase();
      const stats = areaStatsMap?.[key];
      if (!stats) return false;
      if (markerMode === MARKER_MODES.BOROUGHS) return true;
      if (markerMode === MARKER_MODES.AREAS) {
        if (!stats.borough) return false;
        if (focusedBorough) return stats.borough === focusedBorough;
        return activeBoroughs.length === 0 || activeBoroughs.includes(stats.borough);
      }
      if (markerMode === MARKER_MODES.PUBS) {
        if (focusedBorough && stats?.borough !== focusedBorough) return false;
        return nearestAreaKeys.length === 0 || nearestAreaKeys.includes(key);
      }
      return true;
    });
    const hasF = selectedFeatures?.length > 0;
    const hasO = selectedOwnerships?.length > 0;
    const hasY = yearRange && yearRange.min !== null && yearRange.max !== null;
    const hasA = selectedArea && selectedArea.trim().length > 0;
    const hasFav = showOnlyFavorites === true;
    const hasAch = showOnlyAchievements === true;
    if (!hasF && !hasO && !hasY && !hasA && !hasFav && !hasAch) return basePubs;
    return basePubs.filter((pub) => {
      if (hasF && (!pub.features || !selectedFeatures.every((f) => pub.features.includes(f)))) return false;
      if (hasO && (!pub.ownership || !selectedOwnerships.includes(pub.ownership))) return false;
      if (hasY) { const y = parseInt(pub.founded, 10); if (!pub.founded || isNaN(y) || y < yearRange.min || y > yearRange.max) return false; }
      if (hasA && (!pub.area || pub.area.trim().toLowerCase() !== selectedArea.trim().toLowerCase())) return false;
      if (hasFav && pub.isFavorite !== true) return false;
      if (hasAch && (!pub.achievements || pub.achievements.length === 0)) return false;
      return true;
    });
  }, [allPubs, markerMode, selectedFeatures, selectedOwnerships, yearRange, selectedArea, showOnlyFavorites, showOnlyAchievements, areaStatsMap, activeBoroughs, nearestAreaKeys, focusedBorough]);

  // --- Pub handlers ---
  const handlePubPress = useCallback((pub) => setSelectedPub(pub), []);
  const closeCard = useCallback(() => setSelectedPub(null), []);

  const handleToggleVisited = useCallback(async (pubId) => {
    const originalPubs = [...allPubs];
    const originalSelected = selectedPub ? { ...selectedPub } : null;
    const newState = !allPubs.find((p) => p.id === pubId)?.isVisited;
    if (selectedPub?.id === pubId) setSelectedPub({ ...selectedPub, isVisited: newState });
    setAllPubs(allPubs.map((p) => (p.id === pubId ? { ...p, isVisited: newState } : p)));
    try { await togglePubVisited(pubId); } catch {
      setAllPubs(originalPubs);
      if (originalSelected?.id === pubId) setSelectedPub(originalSelected);
    }
  }, [allPubs, selectedPub]);

  const handleToggleFavorite = useCallback(async (pubId) => {
    const originalPubs = [...allPubs];
    const originalSelected = selectedPub ? { ...selectedPub } : null;
    const newState = !allPubs.find((p) => p.id === pubId)?.isFavorite;
    if (selectedPub?.id === pubId) setSelectedPub({ ...selectedPub, isFavorite: newState });
    setAllPubs(allPubs.map((p) => (p.id === pubId ? { ...p, isFavorite: newState } : p)));
    try { await togglePubFavorite(pubId); } catch {
      setAllPubs(originalPubs);
      if (originalSelected?.id === pubId) setSelectedPub(originalSelected);
    }
  }, [allPubs, selectedPub]);

  // --- Navigation helpers ---
  const animateToRegion = useCallback((newRegion, loadPubs = true) => {
    isNavigatingRef.current = true;
    commitMapRegion(newRegion);
    if (mapRef.current) {
      mapRef.current.animateToRegion(newRegion, 1000);
      setTimeout(() => {
        isNavigatingRef.current = false;
        if (loadPubs) loadPubsForViewportRegion?.(newRegion);
      }, 1050);
    } else {
      isNavigatingRef.current = false;
      if (loadPubs) loadPubsForViewportRegion?.(newRegion);
    }
  }, [commitMapRegion, loadPubsForViewportRegion]);

  // --- Search ---
  const searchBorough = useCallback(async (boroughName) => {
    if (!boroughName || typeof boroughName !== 'string' || !boroughName.trim()) return false;
    const normalizedLower = boroughName.trim().toLowerCase();
    let summary = boroughSummaries?.find((s) => s?.borough?.toLowerCase() === normalizedLower) || null;
    let center = summary?.center;
    let bounds = summary?.bounds;
    if (!center || !Number.isFinite(center.latitude)) {
      const boroughPubs = allPubs.filter((p) => p?.borough?.trim().toLowerCase() === normalizedLower);
      const validCoords = boroughPubs.map((p) => ({ lat: parseFloat(p.lat), lon: parseFloat(p.lon) })).filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lon));
      if (validCoords.length > 0) {
        center = { latitude: validCoords.reduce((s, c) => s + c.lat, 0) / validCoords.length, longitude: validCoords.reduce((s, c) => s + c.lon, 0) / validCoords.length };
        bounds = { north: Math.max(...validCoords.map((c) => c.lat)), south: Math.min(...validCoords.map((c) => c.lat)), east: Math.max(...validCoords.map((c) => c.lon)), west: Math.min(...validCoords.map((c) => c.lon)) };
      }
    }
    if (!center || !Number.isFinite(center.latitude)) return false;
    const latSpan = bounds ? Math.max(Math.abs(bounds.north - bounds.south) * 1.2, AREA_ENTER_DELTA) : BOROUGH_EXIT_DELTA * 0.6;
    const lonSpan = bounds ? Math.max(Math.abs(bounds.east - bounds.west) * 1.2, AREA_ENTER_DELTA) : BOROUGH_EXIT_DELTA * 0.6;
    const maxDelta = Math.max(BOROUGH_EXIT_DELTA - 0.01, AREA_ENTER_DELTA);
    setSelectedArea(null);
    setFocusedBorough(boroughName.trim());
    setSelectedPub(null);
    animateToRegion({ latitude: center.latitude, longitude: center.longitude, latitudeDelta: Math.min(latSpan, maxDelta), longitudeDelta: Math.min(lonSpan, maxDelta) });
    return true;
  }, [boroughSummaries, allPubs, animateToRegion]);

  const searchArea = useCallback(async (areaName, applyAreaFilter = false) => {
    setFocusedBorough(null);
    const pubsInArea = allPubs.filter((p) => p.area?.trim().toLowerCase() === areaName.toLowerCase());
    const validPubs = pubsInArea.filter((p) => p.lat && p.lon);
    if (validPubs.length > 0) {
      const centerLat = validPubs.reduce((s, p) => s + parseFloat(p.lat), 0) / validPubs.length;
      const centerLon = validPubs.reduce((s, p) => s + parseFloat(p.lon), 0) / validPubs.length;
      const lats = validPubs.map((p) => parseFloat(p.lat));
      const lons = validPubs.map((p) => parseFloat(p.lon));
      const latDelta = Math.max((Math.max(...lats) - Math.min(...lats)) * 2.5, 0.01);
      const lonDelta = Math.max((Math.max(...lons) - Math.min(...lons)) * 2.5, 0.01);
      setSelectedPub(null);
      if (applyAreaFilter) setSelectedArea(areaName);
      animateToRegion({ latitude: centerLat, longitude: centerLon, latitudeDelta: Math.min(latDelta, 0.05), longitudeDelta: Math.min(lonDelta, 0.05) });
      return true;
    }
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${areaName}, UK`)}&format=json&limit=1`, { headers: { 'User-Agent': 'PubTrackerApp/1.0' } });
      const data = await resp.json();
      if (data?.length > 0) {
        setSelectedPub(null);
        animateToRegion({ latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon), latitudeDelta: 0.02, longitudeDelta: 0.02 });
        return true;
      }
    } catch (error) { console.error('Area search error:', error); }
    return false;
  }, [allPubs, animateToRegion]);

  const searchPub = useCallback((pub) => {
    if (!pub.lat || !pub.lon) return false;
    setSelectedPub(pub);
    animateToRegion({ latitude: parseFloat(pub.lat), longitude: parseFloat(pub.lon), latitudeDelta: 0.01, longitudeDelta: 0.01 });
    return true;
  }, [animateToRegion]);

  const handleSearch = useCallback(async (queryOverride = null) => {
    const queryToUse = queryOverride !== null ? queryOverride : searchQuery;
    if (!queryToUse.trim()) return;
    setShowSuggestions(false);
    Keyboard.dismiss();
    const query = queryToUse.trim().toLowerCase();
    const matchingBorough = allBoroughNames.find((b) => b.toLowerCase() === query || b.toLowerCase().includes(query));
    if (matchingBorough) { await searchBorough(matchingBorough); return; }
    const matchingArea = allAreas.find((a) => a.toLowerCase().includes(query));
    if (matchingArea) { await searchArea(matchingArea); return; }
    const matchingPub = allPubs.find((p) => p.name?.toLowerCase().trim() === query);
    if (matchingPub) { searchPub(matchingPub); return; }
    try {
      const resp = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(`${queryToUse}, UK`)}&format=json&limit=1`, { headers: { 'User-Agent': 'PubTrackerApp/1.0' } });
      const data = await resp.json();
      if (data?.length > 0) {
        setSelectedPub(null);
        const newRegion = { latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon), latitudeDelta: 0.02, longitudeDelta: 0.02 };
        commitMapRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 1000);
        setTimeout(() => loadPubsForViewportRegion?.(newRegion), 1100);
      }
    } catch (error) { console.error('Search error:', error); }
  }, [searchQuery, allAreas, allPubs, allBoroughNames, searchArea, searchPub, searchBorough, commitMapRegion, loadPubsForViewportRegion]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSelectedArea(null);
    setFocusedBorough(null);
    setShowSuggestions(false);
    const currentArea = route.params?.areaToSearch || processedAreaRef.current;
    if (currentArea) clearedAreaRef.current = currentArea;
    const currentBorough = route.params?.boroughToSearch || processedBoroughRef.current;
    if (currentBorough) clearedBoroughRef.current = currentBorough;
    const { areaToSearch, boroughToSearch, ...remainingParams } = route.params || {};
    navigation.setParams(remainingParams);
    processedAreaRef.current = null;
    processedBoroughRef.current = null;
  }, [route.params, navigation]);

  const handleAreaPress = useCallback(async (area) => {
    setSearchQuery(area);
    setShowSuggestions(false);
    Keyboard.dismiss();
    await searchArea(area);
  }, [searchArea]);

  const handlePubSuggestionPress = useCallback((pub) => {
    setSearchQuery(pub.name);
    setShowSuggestions(false);
    Keyboard.dismiss();
    searchPub(pub);
  }, [searchPub]);

  // --- Route param handling ---
  useFocusEffect(
    useCallback(() => {
      const areaToSearch = route.params?.areaToSearch;
      const boroughToSearch = route.params?.boroughToSearch;
      if (areaToSearch && typeof areaToSearch === 'string' && areaToSearch.trim().length > 0 &&
          areaToSearch !== processedAreaRef.current && allPubs.length > 0 && areaToSearch !== clearedAreaRef.current) {
        processedAreaRef.current = areaToSearch;
        clearedAreaRef.current = null;
        searchArea(areaToSearch, true);
        setSearchQuery(areaToSearch);
      } else if (!areaToSearch) { processedAreaRef.current = null; }
      if (boroughToSearch && typeof boroughToSearch === 'string' && boroughToSearch.trim().length > 0 &&
          boroughToSearch !== processedBoroughRef.current && allPubs.length > 0 && boroughToSearch !== clearedBoroughRef.current) {
        processedBoroughRef.current = boroughToSearch;
        clearedBoroughRef.current = null;
        searchBorough(boroughToSearch);
        setSearchQuery(boroughToSearch);
      } else if (!boroughToSearch) { processedBoroughRef.current = null; }
    }, [route.params?.areaToSearch, route.params?.boroughToSearch, allPubs.length, searchArea, searchBorough]),
  );

  // --- Suggestions ---
  const sortedPubs = useMemo(() => [...allPubs].sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase())), [allPubs]);
  const areaSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return allAreas.slice(0, 3);
    const q = searchQuery.trim().toLowerCase();
    return allAreas.filter((a) => a.toLowerCase().includes(q)).slice(0, 3);
  }, [searchQuery, allAreas]);
  const pubSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return sortedPubs.slice(0, 3);
    const q = searchQuery.trim().toLowerCase();
    return allPubs.filter((p) => p.name?.toLowerCase().includes(q)).slice(0, 3);
  }, [searchQuery, allPubs, sortedPubs]);

  // --- Area marker press ---
  const handleAreaMarkerPress = useCallback(async (areaName) => {
    const areaStats = calculateAreaStats(areaName, filteredPubs);
    if (areaStats.pubs.length === 0) return;
    const center = getAreaCenter(areaStats.pubs);
    if (!center) return;
    const lats = areaStats.pubs.map((p) => parseFloat(p.lat));
    const lons = areaStats.pubs.map((p) => parseFloat(p.lon));
    const latDelta = Math.max((Math.max(...lats) - Math.min(...lats)) * 2.5, 0.01);
    const lonDelta = Math.max((Math.max(...lons) - Math.min(...lons)) * 2.5, 0.01);
    setSelectedPub(null);
    animateToRegion({
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: Math.max(Math.min(latDelta, AREA_EXIT_DELTA - 0.005), 0.01),
      longitudeDelta: Math.max(Math.min(lonDelta, AREA_EXIT_DELTA - 0.005), 0.01),
    });
  }, [filteredPubs, calculateAreaStats, animateToRegion]);

  // --- Borough marker press ---
  const handleBoroughMarkerPress = useCallback((summary) => {
    if (!summary?.center) return;
    const bounds = summary.bounds;
    const latSpan = bounds ? Math.max((bounds.north - bounds.south) * 1.6, BOROUGH_EXIT_DELTA) : BOROUGH_EXIT_DELTA;
    const lonSpan = bounds ? Math.max((bounds.east - bounds.west) * 1.6, BOROUGH_EXIT_DELTA) : BOROUGH_EXIT_DELTA;
    setSelectedPub(null);
    animateToRegion({ latitude: summary.center.latitude, longitude: summary.center.longitude, latitudeDelta: latSpan, longitudeDelta: lonSpan });
  }, [animateToRegion]);

  // --- Marker elements ---
  const areaMarkerCacheRef = useRef({ key: null, elements: [] });
  const areaMarkerElements = useMemo(() => {
    if (markerMode === MARKER_MODES.BOROUGHS) return [];
    const entries = Object.entries(areaStatsMap || {})
      .map(([key, s]) => ({ areaKey: key, stats: s, completion: typeof s?.completionPercentage === 'number' ? s.completionPercentage : s?.totalPubs ? (s.visitedPubs / s.totalPubs) * 100 : 0 }))
      .filter(({ stats: s }) => {
        if (!s?.center || !s.totalPubs) return false;
        if (markerMode === MARKER_MODES.AREAS) {
          if (!s.borough) return false;
          if (focusedBorough) return s.borough === focusedBorough;
          return activeBoroughs.length === 0 || activeBoroughs.includes(s.borough);
        }
        return true;
      })
      .sort((a, b) => (a.stats.name || '').localeCompare(b.stats.name || ''));
    const cacheKey = JSON.stringify(entries.map(({ areaKey, stats: s, completion: c }) => [areaKey, Number(s.center.latitude.toFixed(5)), Number(s.center.longitude.toFixed(5)), Number(c.toFixed(4))]));
    if (areaMarkerCacheRef.current.key === cacheKey) return areaMarkerCacheRef.current.elements;
    const els = entries.map(({ areaKey, stats: s, completion: c }) => (
      <Marker key={`area-${areaKey}`} coordinate={s.center} onPress={() => handleAreaMarkerPress(s.name)}>
        <View style={{ backgroundColor: 'transparent' }}><AreaIcon size={36} color={interpolateColor(c)} /></View>
      </Marker>
    ));
    areaMarkerCacheRef.current = { key: cacheKey, elements: els };
    return els;
  }, [markerMode, areaStatsMap, handleAreaMarkerPress, activeBoroughs, focusedBorough]);

  const pubMarkerElements = useMemo(() =>
    filteredPubs.filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
      .map((p) => <PubMarker key={p.id} pub={p} onPress={handlePubPress} />),
  [filteredPubs, handlePubPress]);

  // Borough markers (currently returns empty -- logic retained for future)
  const boroughMarkerElements = useMemo(() => [], [boroughSummaries, shouldTrackBoroughViews]);

  // --- Missing pub ---
  const openMissingPubModal = useCallback(() => { setMissingPubError(null); setIsMissingPubModalVisible(true); }, []);
  const closeMissingPubModal = useCallback(() => { if (!isSubmittingMissingPub) { setIsMissingPubModalVisible(false); setMissingPubError(null); } }, [isSubmittingMissingPub]);
  const handleSubmitMissingPub = useCallback(async ({ pubName, pubLocation }) => {
    setIsSubmittingMissingPub(true);
    setMissingPubError(null);
    try { await submitMissingPubReport(pubName, pubLocation); setIsMissingPubModalVisible(false); setIsMissingPubSuccessVisible(true); }
    catch (error) { setMissingPubError(error?.message || 'Unable to submit report right now. Please try again in a moment.'); }
    finally { setIsSubmittingMissingPub(false); }
  }, []);

  // --- Render ---
  return (
    <View style={styles.container}>
      <SearchBar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onSearch={handleSearch}
        onClear={clearSearch}
        onFilterPress={handleFilterPress}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
      />
      <SearchSuggestions
        visible={showSuggestions}
        searchQuery={searchQuery}
        areaSuggestions={areaSuggestions}
        pubSuggestions={pubSuggestions}
        onAreaPress={handleAreaPress}
        onPubPress={handlePubSuggestionPress}
        keyboardHeight={keyboardHeight}
        keyboardTop={keyboardTop}
      />
      <FilterScreen
        visible={showFilterScreen}
        onClose={handleFilterClose}
        allFeatures={allFeatures}
        selectedFeatures={selectedFeatures}
        allOwnerships={allOwnerships}
        selectedOwnerships={selectedOwnerships}
        yearRange={yearRange}
        minYear={availableYearRange.min}
        maxYear={availableYearRange.max}
        showOnlyFavorites={showOnlyFavorites}
        showOnlyAchievements={showOnlyAchievements}
        onApply={handleFilterApply}
      />
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={mapRegion || LONDON_REGION}
        onRegionChangeComplete={(region) => {
          if (isNavigatingRef.current) return;
          if (regionChangeTimeoutRef.current) clearTimeout(regionChangeTimeoutRef.current);
          regionChangeTimeoutRef.current = setTimeout(() => {
            if (!regionsAreApproximatelyEqual(lastCommittedRegionRef.current, region)) commitMapRegion(region);
            regionChangeTimeoutRef.current = null;
          }, 150);
        }}
        customMapStyle={customMapStyle}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsBuildings={false}
        showsIndoors={false}
        showsPointsOfInterest={false}
        zoomControlEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        toolbarEnabled={false}
        mapPadding={{ bottom: 0 }}
      >
        {currentLocation && (
          <Marker coordinate={currentLocation} anchor={{ x: 0.5, y: 0.5 }} flat>
            <View style={styles.userLocationContainer}>
              <View style={[styles.userLocationArrow, { transform: [{ rotate: `${heading}deg` }] }]}>
                <MaterialCommunityIcons name="arrow-up" size={14} color="#FFFFFF" />
              </View>
              <View style={styles.userLocationDot} />
            </View>
          </Marker>
        )}
        {markerMode === MARKER_MODES.BOROUGHS
          ? boroughMarkerElements
          : markerMode === MARKER_MODES.AREAS
            ? areaMarkerElements
            : pubMarkerElements}
      </MapView>

      <TouchableOpacity style={[styles.missingPubButton, { bottom: floatingButtonBottom }]} onPress={openMissingPubModal}>
        <MaterialCommunityIcons name="flag-plus-outline" size={24} color={AMBER} />
      </TouchableOpacity>
      <TouchableOpacity style={[styles.locationButton, { bottom: floatingButtonBottom }]} onPress={() => handleCurrentLocation(loadPubsForViewportRegion)}>
        <MaterialCommunityIcons name="crosshairs-gps" size={24} color={AMBER} />
      </TouchableOpacity>

      <DraggablePubCard pub={selectedPub} onClose={closeCard} onToggleVisited={handleToggleVisited} onToggleFavorite={handleToggleFavorite} getImageSource={getImageSource} />
      <ReportMissingPubModal visible={isMissingPubModalVisible} onClose={closeMissingPubModal} onSubmit={handleSubmitMissingPub} isSubmitting={isSubmittingMissingPub} errorMessage={missingPubError} />
      {isMissingPubSuccessVisible && (
        <View style={[styles.feedbackToast, { bottom: floatingButtonBottom + 68 }]}>
          <MaterialCommunityIcons name="check-circle" size={20} color={AMBER} />
          <Text style={styles.feedbackToastText}>Missing pub successfully reported</Text>
          <TouchableOpacity onPress={() => setIsMissingPubSuccessVisible(false)} style={styles.feedbackToastCloseButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <MaterialCommunityIcons name="close" size={20} color={DARK_CHARCOAL} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}
