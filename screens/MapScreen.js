import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Keyboard,
  Animated,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { useFocusEffect, useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import * as Location from 'expo-location';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point } from '@turf/helpers';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map as MLRNMap,
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
import { formatDistrictWithCode, getPostcodeDistrictDisplayName } from '../utils/postcodeDistrictDisplayNames';
import postcodeDistrictGeojson from '../data/geo/london_postcode_districts.min.json';
import postcodeAreaOutlinesGeojson from '../data/geo/london_postcode_areas.min.json';
import postcodeAreaLabelPointsGeojson from '../data/geo/london_postcode_area_label_points.min.json';
import { styles as baseStyles } from './map/mapStyles';
import {
  buildPostcodeAreaLayerCollection,
  buildPostcodeDistrictLayerCollection,
  buildPubFeatureCollection,
  DEFAULT_CAMERA,
  getFeatureBounds,
  MAP_COMPLETION_STYLE,
  MAP_STYLE,
  ZOOM_LEVELS,
} from './map/layerUtils';

const PUB_ICON_VISITED = require('../assets/pub_marker_visited.png');
const PUB_ICON_UNVISITED = require('../assets/pub_marker_unvisited.png');

const DEFAULT_SAFE_AREA = { top: 0, right: 0, bottom: 0, left: 0 };
const SHEET_FLOATING_LIFT_PX = 24;
const MAP_CONTROLS_HIDE_PX = 20;
const PUB_FETCH_BUFFER_RATIO = 0.35;
const MIN_PUB_FETCH_ZOOM = ZOOM_LEVELS.PUBS_MIN - 0.15;

const findFeatureByPostcodeArea = (featureCollection, areaCode) => {
  if (!areaCode || typeof areaCode !== 'string') return null;
  const normalized = areaCode.trim().toLowerCase();
  return (featureCollection?.features || []).find(
    (feature) => feature?.properties?.postcode_area?.trim?.().toLowerCase?.() === normalized,
  ) || null;
};

/** MapLibre `onRegionDidChange` uses `bounds` [west, south, east, north]; legacy maps used `visibleBounds`. */
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

/** Match district polygon by outward code, or by locality label / "Name (CODE)" from search bar. */
const findDistrictFeatureBySearchQuery = (featureCollection, rawQuery) => {
  if (!rawQuery || typeof rawQuery !== 'string') return null;
  const trimmed = rawQuery.trim();
  if (!trimmed) return null;
  const q = trimmed.toLowerCase();
  const byCode = findFeatureByName(featureCollection, trimmed);
  if (byCode) return byCode;
  const paren = trimmed.match(/\(([A-Z0-9]{2,5})\)\s*$/i);
  if (paren) {
    const inner = findFeatureByName(featureCollection, paren[1]);
    if (inner) return inner;
  }
  const features = featureCollection?.features || [];
  return (
    features.find((f) => {
      const code = f?.properties?.name;
      if (!code || typeof code !== 'string') return false;
      return getPostcodeDistrictDisplayName(code).toLowerCase() === q;
    })
    || features.find((f) => {
      const code = f?.properties?.name;
      if (!code || typeof code !== 'string') return false;
      return formatDistrictWithCode(code).toLowerCase() === q;
    })
    || features.find((f) => {
      const code = f?.properties?.name;
      if (!code || typeof code !== 'string') return false;
      const label = getPostcodeDistrictDisplayName(code).toLowerCase();
      const full = formatDistrictWithCode(code).toLowerCase();
      return label.includes(q) || full.includes(q);
    })
    || null
  );
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

export default function MapScreen({ safeAreaInsets }) {
  const insets = safeAreaInsets ?? DEFAULT_SAFE_AREA;
  const navigation = useNavigation();
  const route = useRoute();
  const isFocused = useIsFocused();
  const {
    setIsLocationLoaded,
    setIsInitialPubsLoaded,
    postcodeAreaSummaries,
  } = useContext(LoadingContext);
  const { refreshUserStats } = useUserStats();
  const getImageSource = useImageSource();
  const contextLocation = useUserLocation();

  const [allPubs, setAllPubs] = useState([]);
  const [viewportBounds, setViewportBounds] = useState(null);
  const [selectedPub, setSelectedPub] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPostcodeArea, setSelectedPostcodeArea] = useState(null);
  const [selectedDistrictName, setSelectedDistrictName] = useState(null);
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
  const mapZoomRef = useRef(DEFAULT_CAMERA.zoom);
  const initialCameraSetRef = useRef(false);
  const hasUserInteractedRef = useRef(false);
  const sheetTranslateYRef = useRef(null);
  const clearedDistrictRef = useRef(null);
  const clearedPostcodeAreaRef = useRef(null);
  const processedDistrictRef = useRef(null);
  const processedPostcodeAreaRef = useRef(null);
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
    closingTimeMin,
    showFilterScreen,
    allFeatures,
    allOwnerships,
    availableYearRange,
    handleFilterApply,
    handleFilterPress,
    handleFilterClose,
  } = useFilterState(allPubs);

  const postcodeAreaLayerFeatures = useMemo(
    () => buildPostcodeAreaLayerCollection(postcodeAreaOutlinesGeojson, postcodeAreaSummaries),
    [postcodeAreaSummaries],
  );

  const postcodeAreaLabelFeatures = useMemo(
    () => buildPostcodeAreaLayerCollection(postcodeAreaLabelPointsGeojson, postcodeAreaSummaries),
    [postcodeAreaSummaries],
  );

  const selectedDistrictFeature = useMemo(
    () => findFeatureByName(postcodeDistrictGeojson, selectedDistrictName),
    [selectedDistrictName],
  );

  const districtStatsMap = useMemo(() => {
    if (!allPubs.length) return null;
    const statsMap = new Map();
    allPubs.forEach((pub) => {
      const district = typeof pub.area === 'string' ? pub.area.trim().toLowerCase() : '';
      if (!district) return;
      let entry = statsMap.get(district);
      if (!entry) {
        entry = { total: 0, visited: 0 };
        statsMap.set(district, entry);
      }
      entry.total += 1;
      if (pub.isVisited) entry.visited += 1;
    });
    return statsMap;
  }, [allPubs]);

  const postcodeDistrictLayerFeatures = useMemo(
    () => buildPostcodeDistrictLayerCollection(
      postcodeDistrictGeojson,
      selectedPostcodeArea,
      selectedDistrictName,
      districtStatsMap,
    ),
    [selectedPostcodeArea, selectedDistrictName, districtStatsMap],
  );

  const allDistrictNames = useMemo(
    () => (postcodeDistrictGeojson.features || [])
      .map((feature) => feature?.properties?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b)),
    [],
  );

  const allPostcodeAreaNames = useMemo(() => {
    const set = new Set();
    (postcodeDistrictGeojson.features || []).forEach((f) => {
      const a = f?.properties?.postcode_area;
      if (a) set.add(String(a).trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, []);

  const getSummaryBoundsForPostcodeArea = useCallback((areaCode) => {
    if (!areaCode || !Array.isArray(postcodeAreaSummaries)) return null;
    const row = postcodeAreaSummaries.find(
      (s) => s.postcodeArea && s.postcodeArea.trim().toLowerCase() === areaCode.trim().toLowerCase(),
    );
    return row?.bounds || null;
  }, [postcodeAreaSummaries]);

  const fitBoundsObject = useCallback((b, animationDuration = 800) => {
    if (!b || !cameraRef.current) return;
    const { north, south, east, west } = b;
    if (![north, south, east, west].every(Number.isFinite)) return;
    cameraRef.current.fitBounds([west, south, east, north], {
      padding: { top: 140, right: 48, bottom: 180, left: 48 },
      duration: animationDuration,
      easing: 'ease',
    });
  }, []);

  const filteredPubs = useMemo(() => {
    const hasFeatures = selectedFeatures?.length > 0;
    const hasOwnerships = selectedOwnerships?.length > 0;
    const hasYearRange = yearRange && yearRange.min !== null && yearRange.max !== null;
    const hasFavorites = showOnlyFavorites === true;
    const hasAchievements = showOnlyAchievements === true;
    const hasClosingTime = closingTimeMin != null;

    return allPubs.filter((pub) => {
      if (selectedDistrictFeature && !pubInsideFeature(pub, selectedDistrictFeature)) return false;
      if (
        !selectedDistrictFeature &&
        selectedPostcodeArea &&
        typeof pub.postcodeArea === 'string' &&
        pub.postcodeArea.trim().toLowerCase() !== selectedPostcodeArea.trim().toLowerCase()
      ) {
        return false;
      }
      if (hasFeatures && (!pub.features || !selectedFeatures.every((feature) => pub.features.includes(feature)))) return false;
      if (hasOwnerships && (!pub.ownership || !selectedOwnerships.includes(pub.ownership))) return false;
      if (hasYearRange) {
        const foundedYear = parseInt(pub.founded, 10);
        if (!Number.isFinite(foundedYear) || foundedYear < yearRange.min || foundedYear > yearRange.max) return false;
      }
      if (hasFavorites && pub.isFavorite !== true) return false;
      if (hasAchievements && (!pub.achievements || pub.achievements.length === 0)) return false;
      if (hasClosingTime) {
        const closingHour = pub.closing_time ?? 23;
        if (closingTimeMin === 'open_now') {
          const currentHour = new Date().getHours();
          if (closingHour <= currentHour) return false;
        } else if (closingTimeMin === 'past_midnight') {
          if (closingHour < 24) return false;
        }
      }
      return true;
    });
  }, [
    allPubs,
    selectedDistrictFeature,
    selectedPostcodeArea,
    selectedFeatures,
    selectedOwnerships,
    yearRange,
    showOnlyFavorites,
    showOnlyAchievements,
    closingTimeMin,
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

  // When the user selects a district or postcode area, eagerly fetch all pubs
  // within its bounding box regardless of the current zoom level. This ensures
  // pub icons are visible as soon as the area is filtered, even before the
  // camera finishes animating to the right zoom.
  useEffect(() => {
    let rawBounds = null;

    if (selectedDistrictFeature) {
      rawBounds = getFeatureBounds(selectedDistrictFeature);
    } else if (selectedPostcodeArea) {
      const areaFeature = findFeatureByPostcodeArea(postcodeAreaOutlinesGeojson, selectedPostcodeArea);
      if (areaFeature) rawBounds = getFeatureBounds(areaFeature);
    }

    if (!rawBounds) return;
    const [west, south, east, north] = rawBounds;
    const buffered = expandBounds({ north, south, east, west });
    if (buffered && !boundsContain(loadedPubBoundsRef.current, buffered)) {
      requestViewportPubs(buffered);
    }
  }, [selectedDistrictFeature, selectedPostcodeArea, requestViewportPubs]);

  const currentLocation = localLocation || contextLocation;

  useEffect(() => {
    if (contextLocation && !initialCameraSetRef.current && !hasUserInteractedRef.current && cameraRef.current) {
      initialCameraSetRef.current = true;
      cameraRef.current.jumpTo({
        center: [contextLocation.longitude, contextLocation.latitude],
        zoom: ZOOM_LEVELS.PUBS_MIN,
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

  const districtSuggestions = useMemo(() => {
    const toItems = (codes) =>
      codes.map((code) => ({
        code,
        label: formatDistrictWithCode(code),
      }));
    if (!searchQuery.trim()) return toItems(allDistrictNames.slice(0, 4));
    const query = searchQuery.trim().toLowerCase();
    const matched = allDistrictNames.filter((name) => {
      const codeHit = name.toLowerCase().includes(query);
      const labelHit = getPostcodeDistrictDisplayName(name).toLowerCase().includes(query);
      return codeHit || labelHit;
    });
    return toItems(matched.slice(0, 4));
  }, [allDistrictNames, searchQuery]);

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

  const selectPostcodeArea = useCallback((areaCode, updateSearch = true) => {
    if (!areaCode || typeof areaCode !== 'string') return;
    const trimmed = areaCode.trim();
    if (!trimmed) return;
    hasUserInteractedRef.current = true;
    setSelectedPostcodeArea(trimmed);
    setSelectedDistrictName(null);
    setSelectedPub(null);
    if (updateSearch) setSearchQuery(trimmed);
    const b = getSummaryBoundsForPostcodeArea(trimmed);
    if (b) {
      fitBoundsObject(b);
    } else {
      const sample = findFeatureByPostcodeArea(postcodeAreaOutlinesGeojson, trimmed);
      if (sample) fitFeature(sample);
    }
  }, [fitBoundsObject, fitFeature, getSummaryBoundsForPostcodeArea]);

  const selectDistrict = useCallback((feature, updateSearch = true) => {
    const districtName = feature?.properties?.name;
    if (!districtName) return;
    hasUserInteractedRef.current = true;
    setSelectedDistrictName(districtName);
    const parent = feature?.properties?.postcode_area;
    setSelectedPostcodeArea(typeof parent === 'string' && parent.trim() ? parent.trim() : null);
    setSelectedPub(null);
    if (updateSearch) setSearchQuery(formatDistrictWithCode(districtName));
    fitFeature(feature);
  }, [fitFeature, formatDistrictWithCode]);

  const selectPub = useCallback((pub, updateSearch = true) => {
    if (!pub) return;
    hasUserInteractedRef.current = true;
    setSelectedDistrictName(null);
    setSelectedPostcodeArea(null);
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

    const exactArea = allPostcodeAreaNames.find((n) => n.toLowerCase() === query);
    if (exactArea) {
      selectPostcodeArea(exactArea, true);
      return;
    }
    const partialArea = allPostcodeAreaNames.find((n) => n.toLowerCase().includes(query));
    if (partialArea) {
      selectPostcodeArea(partialArea, true);
      return;
    }

    const districtMatch = findDistrictFeatureBySearchQuery(postcodeDistrictGeojson, rawQuery.trim())
      || postcodeDistrictGeojson.features.find(
        (feature) => feature?.properties?.name?.toLowerCase?.().includes?.(query),
      );
    if (districtMatch) {
      selectDistrict(districtMatch, true);
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
  }, [
    allPubs,
    allPostcodeAreaNames,
    postcodeDistrictGeojson,
    searchQuery,
    selectDistrict,
    selectPostcodeArea,
    selectPub,
  ]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    hasUserInteractedRef.current = true;
    setSelectedDistrictName(null);
    setSelectedPostcodeArea(null);
    setShowSuggestions(false);

    const currentDistrict = route.params?.districtToSearch || processedDistrictRef.current;
    if (currentDistrict) clearedDistrictRef.current = currentDistrict;

    const currentPa = route.params?.postcodeAreaToSearch || processedPostcodeAreaRef.current;
    if (currentPa) clearedPostcodeAreaRef.current = currentPa;

    const {
      districtToSearch,
      postcodeAreaToSearch,
      districtCenterLat,
      districtCenterLon,
      districtPostcodeArea,
      ...remainingParams
    } = route.params || {};
    navigation.setParams(remainingParams);
    processedDistrictRef.current = null;
    processedPostcodeAreaRef.current = null;
  }, [navigation, route.params]);

  const handleDistrictSuggestionPress = useCallback((districtCode) => {
    const feature = findFeatureByName(postcodeDistrictGeojson, districtCode);
    if (feature) selectDistrict(feature, true);
    setShowSuggestions(false);
    Keyboard.dismiss();
  }, [selectDistrict]);

  const handlePubSuggestionPress = useCallback((pub) => {
    setShowSuggestions(false);
    Keyboard.dismiss();
    selectPub(pub, true);
  }, [selectPub]);

  useFocusEffect(
    useCallback(() => {
      const districtToSearch = route.params?.districtToSearch;
      const postcodeAreaToSearch = route.params?.postcodeAreaToSearch;
      const districtCenterLat = Number(route.params?.districtCenterLat);
      const districtCenterLon = Number(route.params?.districtCenterLon);

      if (
        districtToSearch &&
        districtToSearch !== processedDistrictRef.current &&
        districtToSearch !== clearedDistrictRef.current
      ) {
        let feature = findFeatureByName(postcodeDistrictGeojson, districtToSearch);
        if (!feature && Number.isFinite(districtCenterLat) && Number.isFinite(districtCenterLon)) {
          feature = findFeatureContainingCoordinate(
            postcodeDistrictGeojson,
            districtCenterLat,
            districtCenterLon,
          );
        }
        if (feature) {
          processedDistrictRef.current = districtToSearch;
          clearedDistrictRef.current = null;
          selectDistrict(feature, false);
          setSearchQuery(formatDistrictWithCode(feature?.properties?.name || districtToSearch));
        } else if (Number.isFinite(districtCenterLat) && Number.isFinite(districtCenterLon) && cameraRef.current) {
          processedDistrictRef.current = districtToSearch;
          clearedDistrictRef.current = null;
          hasUserInteractedRef.current = true;
          setSelectedPub(null);
          setSelectedDistrictName(districtToSearch);
          setSelectedPostcodeArea(route.params?.districtPostcodeArea || null);
          setSearchQuery(formatDistrictWithCode(districtToSearch));
          cameraRef.current.easeTo({
            center: [districtCenterLon, districtCenterLat],
            zoom: Math.max(mapZoomRef.current, 13.2),
            duration: 700,
          });
        }
      } else if (!districtToSearch) {
        processedDistrictRef.current = null;
      }

      if (
        postcodeAreaToSearch &&
        postcodeAreaToSearch !== processedPostcodeAreaRef.current &&
        postcodeAreaToSearch !== clearedPostcodeAreaRef.current
      ) {
        processedPostcodeAreaRef.current = postcodeAreaToSearch;
        clearedPostcodeAreaRef.current = null;
        selectPostcodeArea(postcodeAreaToSearch, false);
        setSearchQuery(postcodeAreaToSearch);
      } else if (!postcodeAreaToSearch) {
        processedPostcodeAreaRef.current = null;
      }
    }, [route.params, selectDistrict, selectPostcodeArea]),
  );

  const handlePostcodeAreaLayerPress = useCallback((event) => {
    const features = event?.features || event?.nativeEvent?.features || [];
    const feature = features[0];
    const areaCode = feature?.properties?.postcode_area;
    if (!areaCode) return;
    selectPostcodeArea(areaCode, true);
  }, [selectPostcodeArea]);

  const handlePostcodeDistrictLayerPress = useCallback((event) => {
    const features = event?.features || event?.nativeEvent?.features || [];
    const feature = features[0];
    const districtName = feature?.properties?.name;
    if (!districtName) return;
    const fullFeature = findFeatureByName(postcodeDistrictGeojson, districtName);
    if (fullFeature) selectDistrict(fullFeature, true);
  }, [selectDistrict]);

  const handlePubPress = useCallback((event) => {
    hasUserInteractedRef.current = true;

    const features = Array.isArray(event?.nativeEvent?.features) ? event.nativeEvent.features : [];
    const pubFeature = features.find((feature) => feature?.properties?.pubId);
    if (!pubFeature) return;
    const pubId = pubFeature.properties?.pubId;
    const pub = allPubs.find((item) => item.id === pubId);
    if (pub) {
      setSelectedPub(pub);
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
      <MLRNMap
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
          const nextBounds = parseVisibleBounds(feature?.visibleBounds ?? feature?.bounds);
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

        <GeoJSONSource id="postcode-areas" data={postcodeAreaLayerFeatures} onPress={handlePostcodeAreaLayerPress}>
          <Layer
            type="fill"
            id="postcode-area-fill"
            maxzoom={ZOOM_LEVELS.AREA_FILL_MAX_ZOOM}
            paint={{
              'fill-color': ['get', 'fillColor'],
              'fill-opacity': MAP_COMPLETION_STYLE.AREA_FILL_OPACITY,
            }}
          />
          <Layer
            type="line"
            id="postcode-area-line"
            paint={{
              'line-color': COLORS.charcoal,
              'line-width': 2.6,
              'line-opacity': 0.92,
            }}
          />
        </GeoJSONSource>

        <GeoJSONSource id="postcode-districts" data={postcodeDistrictLayerFeatures} onPress={handlePostcodeDistrictLayerPress}>
          <Layer
            type="fill"
            id="postcode-district-fill"
            minzoom={ZOOM_LEVELS.DISTRICTS_MIN}
            paint={{
              /* Colour from completion per district only (layerUtils) — never blanket amber at pub zoom. */
              'fill-color': ['get', 'fillColor'],
              /* Slightly stronger opacity when zoomed in (pub zoom) — still scaled by completion per feature. */
              'fill-opacity': [
                'step',
                ['zoom'],
                ['get', 'districtFillOpacity'],
                ZOOM_LEVELS.PUBS_MIN,
                ['get', 'districtFillOpacityPub'],
              ],
            }}
          />
          <Layer
            type="line"
            id="postcode-district-line"
            paint={{
              'line-color': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                COLORS.amber,
                ['boolean', ['get', 'isInFocusedArea'], false],
                COLORS.mediumGrey,
                COLORS.mediumGrey,
              ],
              /* Native MapLibre: ['zoom'] must be top-level interpolate/step input, not inside case. */
              'line-width': [
                'interpolate',
                ['linear'],
                ['zoom'],
                ZOOM_LEVELS.DISTRICTS_MIN,
                ['case', ['boolean', ['get', 'isSelected'], false], 3, 0.35],
                ZOOM_LEVELS.POSTCODE_AREAS_MAX,
                ['case', ['boolean', ['get', 'isSelected'], false], 3, 0.55],
                ZOOM_LEVELS.PUBS_MIN,
                ['case', ['boolean', ['get', 'isSelected'], false], 3, 0.85],
              ],
              'line-opacity': [
                'interpolate',
                ['linear'],
                ['zoom'],
                ZOOM_LEVELS.DISTRICTS_MIN,
                ['case', ['boolean', ['get', 'isSelected'], false], 0.98, 0.1],
                ZOOM_LEVELS.POSTCODE_AREAS_MAX,
                ['case', ['boolean', ['get', 'isSelected'], false], 0.98, 0.2],
                ZOOM_LEVELS.PUBS_MIN,
                ['case', ['boolean', ['get', 'isSelected'], false], 0.98, 0.48],
              ],
            }}
          />
          <Layer
            type="symbol"
            id="postcode-district-labels"
            minzoom={ZOOM_LEVELS.DISTRICT_LABELS_MIN}
            layout={{
              'text-field': ['get', 'districtLabel'],
              'text-size': 10,
              'text-font': ['Open Sans Regular'],
              'text-allow-overlap': false,
              'text-ignore-placement': false,
              'text-anchor': 'center',
              'text-max-width': 14,
            }}
            paint={{
              'text-color': COLORS.charcoal,
              'text-halo-color': '#FFFFFF',
              'text-halo-width': 1.2,
              'text-opacity': 0.85,
            }}
          />
        </GeoJSONSource>

        {/* One Point per letter area (from Shapely) — guarantees a single x/total label. */}
        <GeoJSONSource id="postcode-area-label-points" data={postcodeAreaLabelFeatures}>
          <Layer
            type="symbol"
            id="postcode-area-labels"
            maxzoom={ZOOM_LEVELS.POSTCODE_AREAS_MAX}
            layout={{
              'text-field': [
                'concat',
                ['get', 'postcode_area'],
                '\n',
                ['to-string', ['get', 'visitedPubs']],
                '/',
                ['to-string', ['get', 'totalPubs']],
              ],
              'text-size': 13,
              'text-font': ['Open Sans Bold'],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
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

        <GeoJSONSource
          id="pubs"
          data={pubFeatureCollection}
          cluster={false}
          onPress={handlePubPress}
          hitbox={{ top: 13, right: 13, bottom: 13, left: 13 }}
        >
          <Layer
            type="symbol"
            id="pub-points"
            minzoom={
              // Lower the zoom gate when an area/district filter is active so
              // pub icons are visible as soon as the area is selected.
              (selectedPostcodeArea || selectedDistrictName)
                ? ZOOM_LEVELS.DISTRICTS_MIN
                : ZOOM_LEVELS.PUBS_MIN
            }
            layout={{
              'icon-image': ['case', ['boolean', ['get', 'isVisited'], false], 'pubVisited', 'pubUnvisited'],
              // Scale icons with zoom so they remain legible when shown at lower zoom levels.
              'icon-size': [
                'interpolate', ['linear'], ['zoom'],
                ZOOM_LEVELS.DISTRICTS_MIN, 0.06,
                ZOOM_LEVELS.PUBS_MIN,      0.10,
                17.5,                      0.12,
              ],
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
      </MLRNMap>

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
        districtSuggestions={districtSuggestions}
        pubSuggestions={pubSuggestions}
        onDistrictPress={handleDistrictSuggestionPress}
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
        closingTimeMin={closingTimeMin}
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
