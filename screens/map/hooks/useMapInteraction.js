import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { searchPubsByName, togglePubFavorite, togglePubVisited } from '../../../services/PubService';
import { formatDistrictWithCode, getPostcodeDistrictDisplayName } from '../../../utils/postcodeDistrictDisplayNames';
import { getFeatureBounds } from '../layerUtils';
import {
  boundsContain,
  expandBounds,
  findDistrictFeatureBySearchQuery,
  findFeatureByName,
  findFeatureByPostcodeArea,
  findFeatureContainingCoordinate,
} from '../mapUtils';
import postcodeDistrictGeojson from '../../../data/geo/london_postcode_districts.min.json';
import postcodeAreaOutlinesGeojson from '../../../data/geo/london_postcode_areas.min.json';

/**
 * Combined search + selection + deep-link hook.
 *
 * Owns all state related to what the user has selected on the map
 * (pub, district, postcode area) and what they have typed into the
 * search bar, including typeahead suggestions and keyboard tracking.
 */
export function useMapInteraction({
  allPubs,
  setAllPubs,
  requestViewportPubs,
  loadedPubBoundsRef,
  cameraRef,
  mapZoomRef,
  hasUserInteractedRef,
  fitFeature,
  fitBoundsObject,
  centerOnPub,
  postcodeAreaSummaries,
  refreshUserStats,
  navigation,
  route,
}) {
  const [selectedPub, setSelectedPub] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPostcodeArea, setSelectedPostcodeArea] = useState(null);
  const [selectedDistrictName, setSelectedDistrictName] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [pubSuggestions, setPubSuggestions] = useState([]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState(0);

  const clearedDistrictRef = useRef(null);
  const clearedPostcodeAreaRef = useRef(null);
  const processedDistrictRef = useRef(null);
  const processedPostcodeAreaRef = useRef(null);
  const pubSearchTimeoutRef = useRef(null);

  // ── Derived data ──────────────────────────────────────────────

  const selectedDistrictFeature = useMemo(
    () => findFeatureByName(postcodeDistrictGeojson, selectedDistrictName),
    [selectedDistrictName],
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

  const districtSuggestions = useMemo(() => {
    const toItems = (codes) =>
      codes.map((code) => ({ code, label: formatDistrictWithCode(code) }));
    if (!searchQuery.trim()) return toItems(allDistrictNames.slice(0, 4));
    const query = searchQuery.trim().toLowerCase();
    const matched = allDistrictNames.filter((name) => {
      const codeHit = name.toLowerCase().includes(query);
      const labelHit = getPostcodeDistrictDisplayName(name).toLowerCase().includes(query);
      return codeHit || labelHit;
    });
    return toItems(matched.slice(0, 4));
  }, [allDistrictNames, searchQuery]);

  const getSummaryBoundsForPostcodeArea = useCallback((areaCode) => {
    if (!areaCode || !Array.isArray(postcodeAreaSummaries)) return null;
    const row = postcodeAreaSummaries.find(
      (s) => s.postcodeArea && s.postcodeArea.trim().toLowerCase() === areaCode.trim().toLowerCase(),
    );
    return row?.bounds || null;
  }, [postcodeAreaSummaries]);

  // ── Selection callbacks ───────────────────────────────────────

  /**
   * Ignore stale close callbacks from an older sheet animation if a new pub
   * has already been selected.
   */
  const closeCard = useCallback((expectedPubId = null) => {
    setSelectedPub((current) => {
      if (!expectedPubId) return null;
      return current?.id === expectedPubId ? null : current;
    });
  }, []);

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
  }, [fitBoundsObject, fitFeature, getSummaryBoundsForPostcodeArea, hasUserInteractedRef]);

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
  }, [fitFeature, hasUserInteractedRef]);

  const selectPub = useCallback((pub, updateSearch = true) => {
    if (!pub) return;
    hasUserInteractedRef.current = true;
    setSelectedDistrictName(null);
    setSelectedPostcodeArea(null);
    setSelectedPub(pub);
    if (updateSearch) setSearchQuery(pub.name || '');
    centerOnPub(pub);
    // Server/typeahead suggestions can reference a pub not yet in viewport `allPubs`. Toggles use
    // `allPubs.find` for baseline state and map updates — without this, visited/favourite can look
    // broken until a viewport fetch adds the row (feels like "wait for load").
    if (pub.id != null) {
      setAllPubs((current) => (current.some((p) => p.id === pub.id) ? current : [...current, pub]));
    }
  }, [centerOnPub, hasUserInteractedRef, setAllPubs]);

  // ── Toggle callbacks (optimistic) ────────────────────────────

  const handleToggleVisited = useCallback(async (pubId) => {
    const originalPubs = [...allPubs];
    const originalSelected = selectedPub ? { ...selectedPub } : null;
    const prev =
      selectedPub?.id === pubId
        ? selectedPub
        : allPubs.find((pub) => pub.id === pubId);
    const newState = !prev?.isVisited;

    if (selectedPub?.id === pubId) setSelectedPub({ ...selectedPub, isVisited: newState });
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
  }, [allPubs, refreshUserStats, selectedPub, setAllPubs]);

  const handleToggleFavorite = useCallback(async (pubId) => {
    const originalPubs = [...allPubs];
    const originalSelected = selectedPub ? { ...selectedPub } : null;
    const prev =
      selectedPub?.id === pubId
        ? selectedPub
        : allPubs.find((pub) => pub.id === pubId);
    const newState = !prev?.isFavorite;

    if (selectedPub?.id === pubId) setSelectedPub({ ...selectedPub, isFavorite: newState });
    setAllPubs((current) => current.map((pub) => (
      pub.id === pubId ? { ...pub, isFavorite: newState } : pub
    )));

    try {
      await togglePubFavorite(pubId);
    } catch {
      setAllPubs(originalPubs);
      if (originalSelected?.id === pubId) setSelectedPub(originalSelected);
    }
  }, [allPubs, selectedPub, setAllPubs]);

  // ── Layer press handlers ──────────────────────────────────────

  const handlePostcodeAreaLayerPress = useCallback((event) => {
    const features = event?.features || event?.nativeEvent?.features || [];
    const areaCode = features[0]?.properties?.postcode_area;
    if (areaCode) selectPostcodeArea(areaCode, true);
  }, [selectPostcodeArea]);

  const handlePostcodeDistrictLayerPress = useCallback((event) => {
    const features = event?.features || event?.nativeEvent?.features || [];
    const districtName = features[0]?.properties?.name;
    if (!districtName) return;
    const fullFeature = findFeatureByName(postcodeDistrictGeojson, districtName);
    if (fullFeature) selectDistrict(fullFeature, true);
  }, [selectDistrict]);

  const handlePubPress = useCallback((event) => {
    hasUserInteractedRef.current = true;
    const features = Array.isArray(event?.nativeEvent?.features) ? event.nativeEvent.features : [];
    const pubFeature = features.find((f) => f?.properties?.pubId);
    if (!pubFeature) return;
    const pub = allPubs.find((item) => item.id === pubFeature.properties?.pubId);
    if (pub) setSelectedPub(pub);
  }, [allPubs, hasUserInteractedRef]);

  // ── Search callbacks ──────────────────────────────────────────

  const handleSearch = useCallback(async (queryOverride = null) => {
    const rawQuery = queryOverride !== null ? queryOverride : searchQuery;
    const query = rawQuery.trim().toLowerCase();
    if (!query) return;

    setShowSuggestions(false);
    Keyboard.dismiss();

    const exactArea = allPostcodeAreaNames.find((n) => n.toLowerCase() === query);
    if (exactArea) { selectPostcodeArea(exactArea, true); return; }
    const partialArea = allPostcodeAreaNames.find((n) => n.toLowerCase().includes(query));
    if (partialArea) { selectPostcodeArea(partialArea, true); return; }

    const districtMatch = findDistrictFeatureBySearchQuery(postcodeDistrictGeojson, rawQuery.trim())
      || postcodeDistrictGeojson.features.find(
        (feature) => feature?.properties?.name?.toLowerCase?.().includes?.(query),
      );
    if (districtMatch) { selectDistrict(districtMatch, true); return; }

    const localPubMatch = allPubs.find((pub) => pub?.name?.toLowerCase?.() === query)
      || allPubs.find((pub) => pub?.name?.toLowerCase?.().includes?.(query));
    if (localPubMatch) { selectPub(localPubMatch, true); return; }

    try {
      const serverResults = await searchPubsByName(rawQuery.trim(), 1);
      if (serverResults?.length > 0) selectPub(serverResults[0], true);
    } catch {
      // server search unavailable
    }
  }, [allPubs, allPostcodeAreaNames, searchQuery, selectDistrict, selectPostcodeArea, selectPub]);

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
  }, [hasUserInteractedRef, navigation, route.params]);

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

  // ── Effects ───────────────────────────────────────────────────

  // Keyboard tracking
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
    return () => { keyboardShow.remove(); keyboardHide.remove(); };
  }, []);

  // Typeahead pub search
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
          serverResults.forEach((pub) => { if (!existingIds.has(pub.id)) merged.push(pub); });
          return merged.slice(0, 8);
        });
      } catch {
        // keep local results on server failure
      }
    }, 300);

    return () => { if (pubSearchTimeoutRef.current) clearTimeout(pubSearchTimeoutRef.current); };
  }, [allPubs, searchQuery, showSuggestions]);

  // Eager-fetch pubs when area/district selected
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
  }, [selectedDistrictFeature, selectedPostcodeArea, requestViewportPubs, loadedPubBoundsRef]);

  // Deep-link from Profile → Map
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
          feature = findFeatureContainingCoordinate(postcodeDistrictGeojson, districtCenterLat, districtCenterLon);
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
    }, [route.params, selectDistrict, selectPostcodeArea, cameraRef, mapZoomRef, hasUserInteractedRef]),
  );

  return {
    selectedPub,
    setSelectedPub,
    searchQuery,
    setSearchQuery,
    selectedPostcodeArea,
    selectedDistrictName,
    selectedDistrictFeature,
    showSuggestions,
    setShowSuggestions,
    pubSuggestions,
    districtSuggestions,
    keyboardHeight,
    keyboardTop,
    closeCard,
    selectPostcodeArea,
    selectDistrict,
    selectPub,
    handleToggleVisited,
    handleToggleFavorite,
    handlePostcodeAreaLayerPress,
    handlePostcodeDistrictLayerPress,
    handlePubPress,
    handleSearch,
    clearSearch,
    handleDistrictSuggestionPress,
    handlePubSuggestionPress,
  };
}
