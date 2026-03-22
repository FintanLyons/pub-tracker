import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Keyboard,
  Animated,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchLondonPubs, searchPubsByName, togglePubFavorite, togglePubVisited } from '../services/PubService';
import { submitMissingPubReport } from '../services/ReportService';
import { useUserLocation } from '../contexts/LocationContext';
import SearchBar from '../components/SearchBar';
import SearchSuggestions from '../components/SearchSuggestions';
import DraggablePubCard from '../components/DraggablePubCard';
import ReportMissingPubModal from '../components/ReportMissingPubModal';
import FilterScreen from './FilterScreen';
import { LoadingContext } from '../contexts/LoadingContext';
import { useUserStats } from '../contexts/UserStatsContext';
import { useFilterState } from './map/hooks/useFilterState';
import { useImageSource } from './map/hooks/useImageSource';
import { COLORS } from '../constants/theme';
import boroughGeojson from '../data/geo/london_boroughs.min.json';
import wardGeojson from '../data/geo/london_wards.min.json';
import { styles as baseStyles } from './map/mapStyles';
import {
  buildBoroughFeatureCollection,
  buildPubFeatureCollection,
  buildWardFeatureCollection,
  DEFAULT_CAMERA,
  getFeatureBounds,
  MAP_STYLE,
  ZOOM_LEVELS,
} from './map/layerUtils';

const PUB_ICON_VISITED = require('../assets/pub_marker_visited.png');
const PUB_ICON_UNVISITED = require('../assets/pub_marker_unvisited.png');
const SHEET_FLOATING_LIFT_PX = 24;
const MAP_CONTROLS_HIDE_PX = 20;
const ENABLE_PUB_CLUSTERS = true;
const PUB_FETCH_BUFFER_RATIO = 0.35;
const MIN_PUB_FETCH_ZOOM = ZOOM_LEVELS.PUBS_MIN - 0.15;

const parseVisibleBounds = (visibleBounds) => {
  if (!visibleBounds) return null;

  if (Array.isArray(visibleBounds) && visibleBounds.length === 4 && visibleBounds.every(Number.isFinite)) {
    const [west, south, east, north] = visibleBounds;
    return { north, south, east, west };
  }

  if (Array.isArray(visibleBounds) && visibleBounds.length === 2 && visibleBounds.every(Array.isArray)) {
    const points = visibleBounds.flat();
    if (points.length === 4 && points.every(Number.isFinite)) {
      const [lonA, latA, lonB, latB] = points;
      return {
        north: Math.max(latA, latB),
        south: Math.min(latA, latB),
        east: Math.max(lonA, lonB),
        west: Math.min(lonA, lonB),
      };
    }
  }

  return null;
};

const expandBounds = (bounds, ratio = PUB_FETCH_BUFFER_RATIO) => {
  if (!bounds) return null;
  const latSpan = Math.max(bounds.north - bounds.south, 0.02);
  const lonSpan = Math.max(bounds.east - bounds.west, 0.02);
  const latPad = latSpan * ratio;
  const lonPad = lonSpan * ratio;
  return {
    north: bounds.north + latPad,
    south: bounds.south - latPad,
    east: bounds.east + lonPad,
    west: bounds.west - lonPad,
  };
};

const boundsContain = (outer, inner) => {
  if (!outer || !inner) return false;
  return (
    Number.isFinite(outer.north) && Number.isFinite(outer.south) && Number.isFinite(outer.east) && Number.isFinite(outer.west) &&
    Number.isFinite(inner.north) && Number.isFinite(inner.south) && Number.isFinite(inner.east) && Number.isFinite(inner.west) &&
    outer.north >= inner.north &&
    outer.south <= inner.south &&
    outer.east >= inner.east &&
    outer.west <= inner.west
  );
};

const mergeBounds = (a, b) => {
  if (!a) return b;
  if (!b) return a;
  return {
    north: Math.max(a.north, b.north),
    south: Math.min(a.south, b.south),
    east: Math.max(a.east, b.east),
    west: Math.min(a.west, b.west),
  };
};

const pubInsideFeature = (pub, feature) => {
  if (!feature || !Number.isFinite(pub?.lon) || !Number.isFinite(pub?.lat)) {
    return false;
  }

  try {
    return booleanPointInPolygon(point([pub.lon, pub.lat]), feature);
  } catch {
    return false;
  }
};

const findFeatureByName = (featureCollection, name) => {
  if (!name || typeof name !== 'string') return null;
  const normalized = name.trim().toLowerCase();
  return (featureCollection?.features || []).find(
    (feature) => feature?.properties?.name?.trim?.().toLowerCase?.() === normalized,
  ) || null;
};

const findFeatureContainingCoordinate = (featureCollection, latitude, longitude) => {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const candidatePoint = point([longitude, latitude]);
  return (featureCollection?.features || []).find((feature) => {
    try {
      return booleanPointInPolygon(candidatePoint, feature);
    } catch {
      return false;
    }
  }) || null;
};

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const isFocused = useIsFocused();
  const {
    setIsLocationLoaded,
    setIsInitialPubsLoaded,
    boroughSummaries,
  } = useContext(LoadingContext);
  const { refreshUserStats } = useUserStats();
  const getImageSource = useImageSource();
  const contextLocation = useUserLocation();

  const [allPubs, setAllPubs] = useState([]);
  const [viewportBounds, setViewportBounds] = useState(null);
  const [selectedPub, setSelectedPub] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBoroughName, setSelectedBoroughName] = useState(null);
  const [selectedAreaName, setSelectedAreaName] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pubSuggestions, setPubSuggestions] = useState([]);
  const [localLocation, setLocalLocation] = useState(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState(0);
  const [mapAreaHeight, setMapAreaHeight] = useState(Dimensions.get('window').height);
  const [isMissingPubModalVisible, setIsMissingPubModalVisible] = useState(false);
  const [isSubmittingMissingPub, setIsSubmittingMissingPub] = useState(false);
  const [missingPubError, setMissingPubError] = useState(null);
  const [isMissingPubSuccessVisible, setIsMissingPubSuccessVisible] = useState(false);

  const cameraRef = useRef(null);
  const pubSourceRef = useRef(null);
  const mapZoomRef = useRef(DEFAULT_CAMERA.zoom);
  const initialCameraSetRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const sheetTranslateYRef = useRef(null);
  const clearedAreaRef = useRef(null);
  const clearedBoroughRef = useRef(null);
  const processedAreaRef = useRef(null);
  const processedBoroughRef = useRef(null);
  const loadedPubBoundsRef = useRef(null);
  const inFlightPubFetchRef = useRef(false);
  const latestPubFetchTokenRef = useRef(0);
  const pubFetchTimeoutRef = useRef(null);

  if (sheetTranslateYRef.current == null) {
    sheetTranslateYRef.current = new Animated.Value(Dimensions.get('window').height);
  }
  const sheetTranslateY = sheetTranslateYRef.current;

  const {
    selectedFeatures,
    selectedOwnerships,
    yearRange,
    showOnlyFavorites,
    showOnlyAchievements,
    showFilterScreen,
    allFeatures,
    allOwnerships,
    availableYearRange,
    handleFilterApply,
    handleFilterPress,
    handleFilterClose,
  } = useFilterState(allPubs);

  const boroughFeatures = useMemo(
    () => buildBoroughFeatureCollection(boroughGeojson, boroughSummaries),
    [boroughSummaries],
  );

  const selectedBoroughFeature = useMemo(
    () => findFeatureByName(boroughFeatures, selectedBoroughName),
    [boroughFeatures, selectedBoroughName],
  );

  const selectedWardFeature = useMemo(
    () => findFeatureByName(wardGeojson, selectedAreaName),
    [selectedAreaName],
  );

  const wardStatsMap = useMemo(() => {
    if (!allPubs.length) return null;
    const statsMap = new Map();
    allPubs.forEach((pub) => {
      const area = typeof pub.area === 'string' ? pub.area.trim().toLowerCase() : '';
      if (!area) return;
      let entry = statsMap.get(area);
      if (!entry) {
        entry = { total: 0, visited: 0 };
        statsMap.set(area, entry);
      }
      entry.total += 1;
      if (pub.isVisited) entry.visited += 1;
    });
    return statsMap;
  }, [allPubs]);

  const wardFeatures = useMemo(
    () => buildWardFeatureCollection(wardGeojson, selectedBoroughName, selectedAreaName, wardStatsMap),
    [selectedBoroughName, selectedAreaName, wardStatsMap],
  );

  const allAreaNames = useMemo(
    () => (wardGeojson.features || [])
      .map((feature) => feature?.properties?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    [],
  );

  const allBoroughNames = useMemo(
    () => boroughFeatures.features
      .map((feature) => feature?.properties?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    [boroughFeatures],
  );

  const filteredPubs = useMemo(() => {
    const hasFeatures = selectedFeatures?.length > 0;
    const hasOwnerships = selectedOwnerships?.length > 0;
    const hasYearRange = yearRange && yearRange.min !== null && yearRange.max !== null;
    const hasFavorites = showOnlyFavorites === true;
    const hasAchievements = showOnlyAchievements === true;

    return allPubs.filter((pub) => {
      if (selectedWardFeature && !pubInsideFeature(pub, selectedWardFeature)) return false;
      if (!selectedWardFeature && selectedBoroughFeature && !pubInsideFeature(pub, selectedBoroughFeature)) return false;
      if (hasFeatures && (!pub.features || !selectedFeatures.every((feature) => pub.features.includes(feature)))) return false;
      if (hasOwnerships && (!pub.ownership || !selectedOwnerships.includes(pub.ownership))) return false;
      if (hasYearRange) {
        const foundedYear = parseInt(pub.founded, 10);
        if (!Number.isFinite(foundedYear) || foundedYear < yearRange.min || foundedYear > yearRange.max) return false;
      }
      if (hasFavorites && pub.isFavorite !== true) return false;
      if (hasAchievements && (!pub.achievements || pub.achievements.length === 0)) return false;
      return true;
    });
  }, [
    allPubs,
    selectedWardFeature,
    selectedBoroughFeature,
    selectedFeatures,
    selectedOwnerships,
    yearRange,
    showOnlyFavorites,
    showOnlyAchievements,
  ]);

  const pubFeatureCollection = useMemo(
    () => buildPubFeatureCollection(filteredPubs),
    [filteredPubs],
  );

  const mapSheetMetrics = useMemo(() => {
    const height = mapAreaHeight > 0 ? mapAreaHeight : Dimensions.get('window').height;
    const peek = height * 0.33;
    const fullHeight = Math.max(height, peek + 1);
    return {
      peek,
      collapsedY: fullHeight - peek,
      hiddenY: fullHeight,
    };
  }, [mapAreaHeight]);

  useEffect(() => {
    if (!selectedPub) {
      sheetTranslateY.stopAnimation();
      sheetTranslateY.setValue(mapSheetMetrics.hiddenY);
    }
  }, [selectedPub, mapSheetMetrics.hiddenY, sheetTranslateY]);

  const floatingControlsStyle = useMemo(() => {
    const lift = Math.max(mapSheetMetrics.peek - SHEET_FLOATING_LIFT_PX, 0);
    const { collapsedY, hiddenY } = mapSheetMetrics;
    const translateY = sheetTranslateY.interpolate({
      inputRange: [0, collapsedY, hiddenY],
      outputRange: [-lift, -lift, 0],
      extrapolate: 'clamp',
    });
    const hideThreshold = collapsedY > MAP_CONTROLS_HIDE_PX + 2
      ? collapsedY - MAP_CONTROLS_HIDE_PX
      : collapsedY * 0.35;
    const opacity = sheetTranslateY.interpolate({
      inputRange: [0, hideThreshold, collapsedY, hiddenY],
      outputRange: [0, 0, 1, 1],
      extrapolate: 'clamp',
    });
    return {
      opacity,
      transform: [{ translateY }],
    };
  }, [mapSheetMetrics, sheetTranslateY]);

  const mapControlsBaseBottom = Math.max(insets.bottom, 8) + 4;

  const fitFeature = useCallback((feature, animationDuration = 800) => {
    const bounds = getFeatureBounds(feature);
    if (!bounds || !cameraRef.current) return;
    cameraRef.current.fitBounds(bounds, {
      padding: {
        top: 140,
        right: 48,
        bottom: 180,
        left: 48,
      },
      duration: animationDuration,
      easing: 'ease',
    });
  }, []);

  const centerOnPub = useCallback((pub) => {
    if (!cameraRef.current || !Number.isFinite(pub?.lon) || !Number.isFinite(pub?.lat)) return;
    cameraRef.current.easeTo({
      center: [pub.lon, pub.lat],
      zoom: 15.2,
      duration: 700,
    });
  }, []);

  useEffect(() => {
    setIsInitialPubsLoaded?.(true);
  }, [setIsInitialPubsLoaded]);

  useEffect(() => () => {
    if (pubFetchTimeoutRef.current) {
      clearTimeout(pubFetchTimeoutRef.current);
    }
  }, []);

  const mergeFetchedPubs = useCallback((incomingPubs) => {
    setAllPubs((current) => {
      const nextById = new Map(current.map((pub) => [pub.id, pub]));
      (Array.isArray(incomingPubs) ? incomingPubs : []).forEach((pub) => {
        if (pub?.id) nextById.set(pub.id, pub);
      });
      return Array.from(nextById.values());
    });
  }, []);

  const scheduleViewportPubFetch = useCallback((nextBounds, zoomLevel) => {
    if (!isFocused) return;
    if (!nextBounds) return;
    const effectiveZoom = Number.isFinite(zoomLevel) ? zoomLevel : mapZoomRef.current;
    if (!Number.isFinite(effectiveZoom) || effectiveZoom < MIN_PUB_FETCH_ZOOM) return;

    const bufferedBounds = expandBounds(nextBounds);
    if (!bufferedBounds) return;
    if (boundsContain(loadedPubBoundsRef.current, bufferedBounds)) return;

    if (pubFetchTimeoutRef.current) clearTimeout(pubFetchTimeoutRef.current);
    pubFetchTimeoutRef.current = setTimeout(() => {
      requestViewportPubs(bufferedBounds);
    }, 120);
  }, [isFocused, requestViewportPubs]);

  const requestViewportPubs = useCallback((boundsToFetch) => {
    if (!boundsToFetch || inFlightPubFetchRef.current) return;
    inFlightPubFetchRef.current = true;
    const token = latestPubFetchTokenRef.current + 1;
    latestPubFetchTokenRef.current = token;

    fetchLondonPubs({ bounds: boundsToFetch })
      .then((pubs) => {
        if (latestPubFetchTokenRef.current !== token) return;
        mergeFetchedPubs(pubs);
        loadedPubBoundsRef.current = mergeBounds(loadedPubBoundsRef.current, boundsToFetch);
      })
      .catch((error) => {
        console.error('Failed to load viewport pubs:', error);
      })
      .finally(() => {
        if (latestPubFetchTokenRef.current === token) {
          inFlightPubFetchRef.current = false;
        }
      });
  }, [mergeFetchedPubs]);

  useEffect(() => {
    if (!viewportBounds) return;
    scheduleViewportPubFetch(viewportBounds, mapZoomRef.current);

    return () => {
      if (pubFetchTimeoutRef.current) {
        clearTimeout(pubFetchTimeoutRef.current);
      }
    };
  }, [viewportBounds, scheduleViewportPubFetch]);

  const currentLocation = localLocation || contextLocation;

  useEffect(() => {
    if (contextLocation && !initialCameraSetRef.current && !hasUserInteractedRef.current && cameraRef.current) {
      initialCameraSetRef.current = true;
      cameraRef.current.jumpTo({
        center: [contextLocation.longitude, contextLocation.latitude],
        zoom: 11.6,
      });
    }
    setIsLocationLoaded?.(true);
  }, [contextLocation, setIsLocationLoaded]);

  useEffect(() => {
    const keyboardShow = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates.height);
      const top = event.endCoordinates.screenY !== undefined
        ? event.endCoordinates.screenY
        : Dimensions.get('window').height - event.endCoordinates.height;
      setKeyboardTop(top);
    });
    const keyboardHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      setKeyboardTop(0);
    });

    return () => {
      keyboardShow.remove();
      keyboardHide.remove();
    };
  }, []);

  const pubSearchTimeoutRef = useRef(null);

  useEffect(() => {
    const trimmed = searchQuery.trim().toLowerCase();
    if (!trimmed || !showSuggestions) {
      setPubSuggestions([]);
      if (pubSearchTimeoutRef.current) clearTimeout(pubSearchTimeoutRef.current);
      return;
    }

    const localResults = allPubs
      .filter((pub) => typeof pub?.name === 'string' && pub.name.toLowerCase().includes(trimmed))
      .slice(0, 5);
    setPubSuggestions(localResults);

    if (pubSearchTimeoutRef.current) clearTimeout(pubSearchTimeoutRef.current);
    pubSearchTimeoutRef.current = setTimeout(async () => {
      try {
        const serverResults = await searchPubsByName(searchQuery.trim(), 5);
        if (!Array.isArray(serverResults) || serverResults.length === 0) return;
        setPubSuggestions((current) => {
          const existingIds = new Set(current.map((p) => p.id));
          const merged = [...current];
          serverResults.forEach((pub) => {
            if (!existingIds.has(pub.id)) merged.push(pub);
          });
          return merged.slice(0, 8);
        });
      } catch {
        // keep local results on server failure
      }
    }, 300);

    return () => {
      if (pubSearchTimeoutRef.current) clearTimeout(pubSearchTimeoutRef.current);
    };
  }, [allPubs, searchQuery, showSuggestions]);

  useEffect(() => {
    if (!selectedPub) return;
    const existsInFilteredSet = filteredPubs.some((pub) => pub.id === selectedPub.id);
    if (!existsInFilteredSet) {
      setSelectedPub(null);
    }
  }, [filteredPubs, selectedPub]);

  const areaSuggestions = useMemo(() => {
    if (!searchQuery.trim()) return allAreaNames.slice(0, 4);
    const query = searchQuery.trim().toLowerCase();
    return allAreaNames.filter((name) => name.toLowerCase().includes(query)).slice(0, 4);
  }, [allAreaNames, searchQuery]);

  const closeCard = useCallback(() => setSelectedPub(null), []);

  const handleToggleVisited = useCallback(async (pubId) => {
    const originalPubs = [...allPubs];
    const originalSelected = selectedPub ? { ...selectedPub } : null;
    const newState = !allPubs.find((pub) => pub.id === pubId)?.isVisited;

    if (selectedPub?.id === pubId) {
      setSelectedPub({ ...selectedPub, isVisited: newState });
    }

    setAllPubs((current) => current.map((pub) => (
      pub.id === pubId ? { ...pub, isVisited: newState } : pub
    )));

    try {
      await togglePubVisited(pubId);
      refreshUserStats();
    } catch {
      setAllPubs(originalPubs);
      if (originalSelected?.id === pubId) setSelectedPub(originalSelected);
    }
  }, [allPubs, refreshUserStats, selectedPub]);

  const handleToggleFavorite = useCallback(async (pubId) => {
    const originalPubs = [...allPubs];
    const originalSelected = selectedPub ? { ...selectedPub } : null;
    const newState = !allPubs.find((pub) => pub.id === pubId)?.isFavorite;

    if (selectedPub?.id === pubId) {
      setSelectedPub({ ...selectedPub, isFavorite: newState });
    }

    setAllPubs((current) => current.map((pub) => (
      pub.id === pubId ? { ...pub, isFavorite: newState } : pub
    )));

    try {
      await togglePubFavorite(pubId);
    } catch {
      setAllPubs(originalPubs);
      if (originalSelected?.id === pubId) setSelectedPub(originalSelected);
    }
  }, [allPubs, selectedPub]);

  const selectBorough = useCallback((feature, updateSearch = true) => {
    const boroughName = feature?.properties?.name;
    if (!boroughName) return;
    hasUserInteractedRef.current = true;
    setSelectedBoroughName(boroughName);
    setSelectedAreaName(null);
    setSelectedPub(null);
    if (updateSearch) setSearchQuery(boroughName);
    fitFeature(feature);
  }, [fitFeature]);

  const selectArea = useCallback((feature, updateSearch = true) => {
    const areaName = feature?.properties?.name;
    if (!areaName) return;
    hasUserInteractedRef.current = true;
    setSelectedAreaName(areaName);
    setSelectedBoroughName(feature?.properties?.borough || null);
    setSelectedPub(null);
    if (updateSearch) setSearchQuery(areaName);
    fitFeature(feature);
  }, [fitFeature]);

  const selectPub = useCallback((pub, updateSearch = true) => {
    if (!pub) return;
    hasUserInteractedRef.current = true;
    setSelectedAreaName(null);
    setSelectedBoroughName(null);
    setSelectedPub(pub);
    if (updateSearch) setSearchQuery(pub.name || '');
    centerOnPub(pub);
  }, [centerOnPub]);

  const handleSearch = useCallback(async (queryOverride = null) => {
    const rawQuery = queryOverride !== null ? queryOverride : searchQuery;
    const query = rawQuery.trim().toLowerCase();
    if (!query) return;

    setShowSuggestions(false);
    Keyboard.dismiss();

    const boroughMatch = findFeatureByName(boroughFeatures, query)
      || boroughFeatures.features.find((feature) => feature?.properties?.name?.toLowerCase?.().includes?.(query));
    if (boroughMatch) {
      selectBorough(boroughMatch, true);
      return;
    }

    const wardMatch = findFeatureByName(wardGeojson, query)
      || wardGeojson.features.find((feature) => feature?.properties?.name?.toLowerCase?.().includes?.(query));
    if (wardMatch) {
      selectArea(wardMatch, true);
      return;
    }

    const localPubMatch = allPubs.find((pub) => pub?.name?.toLowerCase?.() === query)
      || allPubs.find((pub) => pub?.name?.toLowerCase?.().includes?.(query));
    if (localPubMatch) {
      selectPub(localPubMatch, true);
      return;
    }

    try {
      const serverResults = await searchPubsByName(rawQuery.trim(), 1);
      if (serverResults?.length > 0) {
        const pub = serverResults[0];
        selectPub(pub, true);
      }
    } catch {
      // server search unavailable
    }
  }, [allPubs, boroughFeatures, searchQuery, selectArea, selectBorough, selectPub]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    hasUserInteractedRef.current = true;
    setSelectedAreaName(null);
    setSelectedBoroughName(null);
    setShowSuggestions(false);

    const currentArea = route.params?.areaToSearch || processedAreaRef.current;
    if (currentArea) clearedAreaRef.current = currentArea;

    const currentBorough = route.params?.boroughToSearch || processedBoroughRef.current;
    if (currentBorough) clearedBoroughRef.current = currentBorough;

    const { areaToSearch, boroughToSearch, areaCenterLat, areaCenterLon, areaBorough, ...remainingParams } = route.params || {};
    navigation.setParams(remainingParams);
    processedAreaRef.current = null;
    processedBoroughRef.current = null;
  }, [navigation, route.params]);

  const handleAreaPress = useCallback((areaName) => {
    const feature = findFeatureByName(wardGeojson, areaName);
    if (feature) selectArea(feature, true);
    setShowSuggestions(false);
    Keyboard.dismiss();
  }, [selectArea]);

  const handlePubSuggestionPress = useCallback((pub) => {
    setShowSuggestions(false);
    Keyboard.dismiss();
    selectPub(pub, true);
  }, [selectPub]);

  useFocusEffect(
    useCallback(() => {
      const areaToSearch = route.params?.areaToSearch;
      const boroughToSearch = route.params?.boroughToSearch;
      const areaCenterLat = Number(route.params?.areaCenterLat);
      const areaCenterLon = Number(route.params?.areaCenterLon);

      if (
        areaToSearch &&
        areaToSearch !== processedAreaRef.current &&
        areaToSearch !== clearedAreaRef.current
      ) {
        let feature = findFeatureByName(wardGeojson, areaToSearch);
        if (!feature && Number.isFinite(areaCenterLat) && Number.isFinite(areaCenterLon)) {
          feature = findFeatureContainingCoordinate(wardGeojson, areaCenterLat, areaCenterLon);
        }
        if (feature) {
          processedAreaRef.current = areaToSearch;
          clearedAreaRef.current = null;
          selectArea(feature, false);
          setSearchQuery(feature?.properties?.name || areaToSearch);
        } else if (Number.isFinite(areaCenterLat) && Number.isFinite(areaCenterLon) && cameraRef.current) {
          processedAreaRef.current = areaToSearch;
          clearedAreaRef.current = null;
          hasUserInteractedRef.current = true;
          setSelectedPub(null);
          setSelectedAreaName(areaToSearch);
          setSelectedBoroughName(route.params?.areaBorough || null);
          setSearchQuery(areaToSearch);
          cameraRef.current.easeTo({
            center: [areaCenterLon, areaCenterLat],
            zoom: Math.max(mapZoomRef.current, 13.2),
            duration: 700,
          });
        }
      } else if (!areaToSearch) {
        processedAreaRef.current = null;
      }

      if (
        boroughToSearch &&
        boroughToSearch !== processedBoroughRef.current &&
        boroughToSearch !== clearedBoroughRef.current
      ) {
        const feature = findFeatureByName(boroughFeatures, boroughToSearch);
        if (feature) {
          processedBoroughRef.current = boroughToSearch;
          clearedBoroughRef.current = null;
          selectBorough(feature, false);
          setSearchQuery(boroughToSearch);
        }
      } else if (!boroughToSearch) {
        processedBoroughRef.current = null;
      }
    }, [boroughFeatures, route.params, selectArea, selectBorough]),
  );

  const handleBoroughPress = useCallback((event) => {
    const features = event?.features || event?.nativeEvent?.features || [];
    const feature = features[0];
    const boroughName = feature?.properties?.name;
    if (!boroughName) return;
    const fullFeature = findFeatureByName(boroughFeatures, boroughName);
    if (fullFeature) selectBorough(fullFeature, true);
  }, [boroughFeatures, selectBorough]);

  const handleWardPress = useCallback((event) => {
    const features = event?.features || event?.nativeEvent?.features || [];
    const feature = features[0];
    const wardName = feature?.properties?.name;
    if (!wardName) return;
    const fullFeature = findFeatureByName(wardGeojson, wardName);
    if (fullFeature) selectArea(fullFeature, true);
  }, [selectArea]);

  const handlePubPress = useCallback(async (event) => {
    hasUserInteractedRef.current = true;

    const features = Array.isArray(event?.nativeEvent?.features) ? event.nativeEvent.features : [];
    const pubFeature = features.find((feature) => !feature?.properties?.cluster && feature?.properties?.pubId);
    if (pubFeature) {
      const pubId = pubFeature.properties?.pubId;
      const pub = allPubs.find((item) => item.id === pubId);
      if (pub) {
        setSelectedPub(pub);
      }
      return;
    }

    const clusterFeature = features.find((feature) => feature?.properties?.cluster);
    if (clusterFeature && pubSourceRef.current) {
      try {
        const zoom = await pubSourceRef.current.getClusterExpansionZoom(clusterFeature.properties?.cluster_id);
        cameraRef.current?.easeTo({
          center: clusterFeature.geometry.coordinates,
          zoom,
          duration: 500,
        });
      } catch (error) {
        console.error('Failed to expand cluster:', error);
      }
    }
  }, [allPubs]);

  const handleCurrentLocation = useCallback(async () => {
    try {
      hasUserInteractedRef.current = true;

      let nextLocation = currentLocation;

      if (!nextLocation) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;

        const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        nextLocation = {
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        };
        setLocalLocation(nextLocation);
      }

      if (!nextLocation) return;

      cameraRef.current?.easeTo({
        center: [nextLocation.longitude, nextLocation.latitude],
        zoom: Math.max(mapZoomRef.current, 14.5),
        duration: 700,
      });
    } catch (error) {
      console.error('Error getting current location:', error);
    }
  }, [currentLocation]);

  const openMissingPubModal = useCallback(() => {
    setMissingPubError(null);
    setIsMissingPubModalVisible(true);
  }, []);

  const closeMissingPubModal = useCallback(() => {
    if (!isSubmittingMissingPub) {
      setIsMissingPubModalVisible(false);
      setMissingPubError(null);
    }
  }, [isSubmittingMissingPub]);

  const handleSubmitMissingPub = useCallback(async ({ pubName, pubLocation }) => {
    setIsSubmittingMissingPub(true);
    setMissingPubError(null);
    try {
      await submitMissingPubReport(pubName, pubLocation);
      setIsMissingPubModalVisible(false);
      setIsMissingPubSuccessVisible(true);
    } catch (error) {
      setMissingPubError(error?.message || 'Unable to submit report right now. Please try again in a moment.');
    } finally {
      setIsSubmittingMissingPub(false);
    }
  }, []);

  const currentLocationShape = useMemo(() => {
    if (!currentLocation) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'Point',
            coordinates: [currentLocation.longitude, currentLocation.latitude],
          },
        },
      ],
    };
  }, [currentLocation]);

  return (
    <View style={baseStyles.container} onLayout={(event) => setMapAreaHeight(event.nativeEvent.layout.height)}>
      <Map
        style={StyleSheet.absoluteFillObject}
        mapStyle={MAP_STYLE}
        logo={false}
        compass={false}
        attributionPosition={{ bottom: 8, left: 8 }}
        androidView="surface"
        touchPitch={false}
        touchRotate={false}
        onRegionDidChange={(event) => {
          const feature = event?.nativeEvent;
          const zoomLevel = Number.isFinite(feature?.zoomLevel) ? feature.zoomLevel : feature?.zoom;
          if (Number.isFinite(zoomLevel)) {
            mapZoomRef.current = zoomLevel;
          }
          const nextBounds = parseVisibleBounds(feature?.visibleBounds);
          if (nextBounds) {
            setViewportBounds((prev) => {
              if (
                prev &&
                Math.abs(prev.north - nextBounds.north) < 0.0005 &&
                Math.abs(prev.south - nextBounds.south) < 0.0005 &&
                Math.abs(prev.east - nextBounds.east) < 0.0005 &&
                Math.abs(prev.west - nextBounds.west) < 0.0005
              ) {
                return prev;
              }
              return nextBounds;
            });
            scheduleViewportPubFetch(nextBounds, zoomLevel);
          }
        }}
        onDidFailLoadingMap={() => console.warn('MapLibre: map failed to load')}
      >
        <Camera ref={cameraRef} initialViewState={DEFAULT_CAMERA} minZoom={8.5} maxZoom={17.5} />
        <Images images={{ pubVisited: PUB_ICON_VISITED, pubUnvisited: PUB_ICON_UNVISITED }} />

        <GeoJSONSource id="boroughs" data={boroughFeatures} onPress={handleBoroughPress}>
          <Layer
            type="fill"
            id="borough-fill"
            maxzoom={ZOOM_LEVELS.BOROUGHS_MAX}
            paint={{
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': 0.24,
            }}
          />
          <Layer
            type="line"
            id="borough-line"
            maxzoom={ZOOM_LEVELS.BOROUGHS_MAX}
            paint={{
              'line-color': COLORS.charcoal,
              'line-width': 1.2,
              'line-opacity': 0.55,
            }}
          />
          <Layer
            type="symbol"
            id="borough-labels"
            maxzoom={ZOOM_LEVELS.BOROUGHS_MAX}
            layout={{
              'text-field': [
                'concat',
                ['get', 'name'],
                '\n',
                ['to-string', ['get', 'visitedPubs']],
                '/',
                ['to-string', ['get', 'totalPubs']],
              ],
              'text-size': 12,
              'text-font': ['Open Sans Bold'],
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-anchor': 'center',
              'text-max-width': 8,
            }}
            paint={{
              'text-color': COLORS.charcoal,
              'text-halo-color': '#FFFFFF',
              'text-halo-width': 1.5,
              'text-opacity': 0.9,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="wards" data={wardFeatures} onPress={handleWardPress}>
          <Layer
            type="fill"
            id="ward-fill"
            minzoom={ZOOM_LEVELS.WARDS_MIN}
            maxzoom={ZOOM_LEVELS.WARDS_MAX}
            paint={{
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': ['case', ['boolean', ['get', 'isSelected'], false], 0.18, 0.08],
            }}
          />
          <Layer
            type="line"
            id="ward-line"
            minzoom={ZOOM_LEVELS.WARDS_MIN}
            maxzoom={ZOOM_LEVELS.WARDS_MAX}
            paint={{
              'line-color': ['case', ['boolean', ['get', 'isSelected'], false], COLORS.amber, COLORS.mediumGrey],
              'line-width': ['case', ['boolean', ['get', 'isSelected'], false], 3, 0.8],
              'line-opacity': ['case', ['boolean', ['get', 'isSelected'], false], 0.98, 0.55],
            }}
          />
          <Layer
            type="symbol"
            id="ward-labels"
            minzoom={ZOOM_LEVELS.WARDS_MIN}
            maxzoom={ZOOM_LEVELS.WARDS_MAX}
            layout={{
              'text-field': ['get', 'name'],
              'text-size': 11,
              'text-font': ['Open Sans Regular'],
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-anchor': 'center',
              'text-max-width': 7,
            }}
            paint={{
              'text-color': COLORS.charcoal,
              'text-halo-color': '#FFFFFF',
              'text-halo-width': 1.2,
              'text-opacity': 0.85,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource
          id="pubs"
          ref={pubSourceRef}
          data={pubFeatureCollection}
          cluster={ENABLE_PUB_CLUSTERS}
          clusterRadius={42}
          clusterMaxZoom={13}
          onPress={handlePubPress}
          hitbox={{ top: 13, right: 13, bottom: 13, left: 13 }}
        >
          <Layer
            type="circle"
            id="pub-clusters"
            minzoom={ZOOM_LEVELS.PUBS_MIN}
            filter={['has', 'point_count']}
            paint={{
              'circle-color': COLORS.charcoal,
              'circle-stroke-color': COLORS.amber,
              'circle-stroke-width': 2,
              'circle-radius': [
                'step',
                ['get', 'point_count'],
                18,
                10, 22,
                25, 28,
                50, 34,
              ],
              'circle-opacity': 0.9,
            }}
          />
          <Layer
            type="symbol"
            id="pub-cluster-count"
            minzoom={ZOOM_LEVELS.PUBS_MIN}
            filter={['has', 'point_count']}
            layout={{
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 12,
              'text-ignore-placement': true,
              'text-allow-overlap': true,
            }}
            paint={{
              'text-color': '#FFFFFF',
            }}
          />
          <Layer
            type="symbol"
            id="pub-points"
            minzoom={ZOOM_LEVELS.PUBS_MIN}
            filter={['!', ['has', 'point_count']]}
            layout={{
              'icon-image': ['case', ['boolean', ['get', 'isVisited'], false], 'pubVisited', 'pubUnvisited'],
              'icon-size': 0.12,
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-anchor': 'bottom',
            }}
          />
        </GeoJSONSource>

        {currentLocationShape && (
          <GeoJSONSource id="current-location" data={currentLocationShape}>
            <Layer
              type="circle"
              id="current-location-dot"
              paint={{
                'circle-color': '#4285F4',
                'circle-radius': 7,
                'circle-stroke-color': '#FFFFFF',
                'circle-stroke-width': 3,
              }}
            />
          </GeoJSONSource>
        )}
      </Map>

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

      <DraggablePubCard
        pub={selectedPub}
        containerHeight={mapAreaHeight}
        translateY={sheetTranslateY}
        onClose={closeCard}
        onToggleVisited={handleToggleVisited}
        onToggleFavorite={handleToggleFavorite}
        getImageSource={getImageSource}
      />

      <Animated.View
        pointerEvents="box-none"
        style={[
          screenStyles.floatingLeft,
          { bottom: mapControlsBaseBottom + 8 },
          floatingControlsStyle,
        ]}
      >
        <TouchableOpacity style={baseStyles.mapFloatingButton} onPress={openMissingPubModal}>
          <MaterialCommunityIcons name="flag-plus-outline" size={24} color={COLORS.amber} />
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        pointerEvents="box-none"
        style={[
          screenStyles.floatingRight,
          { bottom: mapControlsBaseBottom + 8 },
          floatingControlsStyle,
        ]}
      >
        <TouchableOpacity style={baseStyles.mapFloatingButton} onPress={handleCurrentLocation}>
          <MaterialCommunityIcons name="crosshairs-gps" size={24} color={COLORS.amber} />
        </TouchableOpacity>
      </Animated.View>

      <ReportMissingPubModal
        visible={isMissingPubModalVisible}
        onClose={closeMissingPubModal}
        onSubmit={handleSubmitMissingPub}
        isSubmitting={isSubmittingMissingPub}
        errorMessage={missingPubError}
      />

      {isMissingPubSuccessVisible && (
        <Animated.View
          style={[
            baseStyles.feedbackToast,
            screenStyles.feedbackToast,
            { bottom: mapControlsBaseBottom + 124 },
            floatingControlsStyle,
          ]}
        >
          <MaterialCommunityIcons name="check-circle" size={20} color={COLORS.amber} />
          <Text style={baseStyles.feedbackToastText}>Missing pub successfully reported</Text>
          <TouchableOpacity
            onPress={() => setIsMissingPubSuccessVisible(false)}
            style={baseStyles.feedbackToastCloseButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="close" size={20} color={COLORS.charcoal} />
          </TouchableOpacity>
        </Animated.View>
      )}
    </View>
  );
}

const screenStyles = StyleSheet.create({
  floatingLeft: {
    position: 'absolute',
    left: 16,
    zIndex: 1001,
    elevation: 6,
  },
  floatingRight: {
    position: 'absolute',
    right: 16,
    zIndex: 1001,
    elevation: 6,
  },
  feedbackToast: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1002,
    elevation: 7,
  },
});
