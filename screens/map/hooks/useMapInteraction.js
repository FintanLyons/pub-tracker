import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Dimensions, Keyboard } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import {
  fetchPubById,
  reloadVisitedFavoriteSets,
  searchPubsByName,
  setPubFavorite,
  setPubVisited,
} from '../../../services/PubService';
import { useToast } from '../../../contexts/ToastContext';
import { formatDistrictWithCode, getPostcodeDistrictDisplayName } from '../../../utils/postcodeDistrictDisplayNames';
import { distanceMeters } from '../../../utils/geo';
import { getFeatureBounds, ZOOM_LEVELS } from '../layerUtils';
import {
  approximateBoundsFromCenter,
  boundsContain,
  expandBounds,
  findDistrictFeatureBySearchQuery,
  findFeatureByName,
  findFeatureByPostcodeArea,
  findFeatureContainingCoordinate,
} from '../mapUtils';
import {
  postcodeAreaOutlinesGeojson,
  postcodeDistrictGeojson,
} from '../../../data/geo/supportedPostcodeGeo';

const SAVE_FAILED_MESSAGE = "Couldn't save — check your connection and try again.";
/** Wait for taps to settle before recomputing stats (one refresh for several taps). */
const STATS_REFRESH_DELAY_MS = 1200;

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
  postcodeAreaSummaries,
  currentLocation,
  refreshUserStats,
  navigation,
  route,
}) {
  const [selectedPub, setSelectedPub] = useState(null);
  /** Bumped on every pub select so the sheet re-opens when the same pub is tapped again. */
  const [pubSelectionSeq, setPubSelectionSeq] = useState(0);
  /** Map marker highlight; cleared as soon as dismiss starts (before sheet animation ends). */
  const [mapHighlightedPubId, setMapHighlightedPubId] = useState(null);
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
  const processedSummonPubRef = useRef(null);
  const pubSearchTimeoutRef = useRef(null);
  const normalizeSearchText = useCallback((value) => String(value || '').trim().toLowerCase(), []);
  const removeLeadingThe = useCallback((value) => value.replace(/^the\s+/i, '').trim(), []);
  const getQueryVariants = useCallback((value) => {
    const normalized = normalizeSearchText(value);
    const withoutLeadingThe = removeLeadingThe(normalized);
    return { normalized, withoutLeadingThe };
  }, [normalizeSearchText, removeLeadingThe]);
  const getPubMatchRank = useCallback((pubName, rawQuery) => {
    const { normalized: query, withoutLeadingThe: queryNoThe } = getQueryVariants(rawQuery);
    if (!query) return null;
    const { normalized: name, withoutLeadingThe: nameNoThe } = getQueryVariants(pubName);
    const pairs = [
      [query, name],
      [queryNoThe, name],
      [query, nameNoThe],
      [queryNoThe, nameNoThe],
    ].filter(([q, n]) => q.length > 0 && n.length > 0);

    for (const [q, n] of pairs) {
      if (n === q) return 0; // exact
    }
    for (const [q, n] of pairs) {
      if (n.startsWith(q)) return 1; // prefix
    }
    for (const [q, n] of pairs) {
      if (n.includes(q)) return 2; // contains
    }
    return null;
  }, [getQueryVariants]);
  /** Server/typeahead rows omit `features`; viewport rows from formatPub always include it. */
  const needsFullPubFetch = useCallback(
    (pub) => pub?.id != null && !Array.isArray(pub.features),
    [],
  );

  const resolvePubForSelection = useCallback(async (pub) => {
    if (!pub?.id || !needsFullPubFetch(pub)) return pub;
    try {
      const full = await fetchPubById(pub.id);
      return full || pub;
    } catch {
      return pub;
    }
  }, [needsFullPubFetch]);

  const rankPubsForQuery = useCallback((pubs, rawQuery, limit = 8) => {
    const ranked = (Array.isArray(pubs) ? pubs : [])
      .map((pub) => ({ pub, rank: getPubMatchRank(pub?.name, rawQuery) }))
      .filter((item) => item.rank !== null)
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        return String(a.pub?.name || '').localeCompare(String(b.pub?.name || ''));
      })
      .slice(0, limit)
      .map((item) => item.pub);
    return ranked;
  }, [getPubMatchRank]);

  // ── Derived data ──────────────────────────────────────────────

  const selectedDistrictFeature = useMemo(
    () => findFeatureByName(postcodeDistrictGeojson, selectedDistrictName),
    [selectedDistrictName],
  );

  const allDistrictNames = useMemo(
    () => Array.from(new Set((postcodeDistrictGeojson.features || [])
      .map((feature) => feature?.properties?.name)
      .filter(Boolean)
      .map((name) => String(name).trim())))
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
    const hasLocation =
      Number.isFinite(currentLocation?.latitude) && Number.isFinite(currentLocation?.longitude);
    if (!searchQuery.trim()) {
      if (!hasLocation) return toItems(allDistrictNames.slice(0, 4));
      const nearest = allDistrictNames
        .map((code) => {
          const feature = findFeatureByName(postcodeDistrictGeojson, code);
          const bounds = feature ? getFeatureBounds(feature) : null;
          if (!bounds) return null;
          const [west, south, east, north] = bounds;
          const center = { latitude: (north + south) / 2, longitude: (east + west) / 2 };
          return {
            code,
            distance: distanceMeters(currentLocation, center),
          };
        })
        .filter(Boolean)
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 4)
        .map((item) => item.code);
      if (nearest.length > 0) return toItems(nearest);
      return toItems(allDistrictNames.slice(0, 4));
    }
    const query = searchQuery.trim().toLowerCase();
    const matched = allDistrictNames.filter((name) => {
      const codeHit = name.toLowerCase().includes(query);
      const labelHit = getPostcodeDistrictDisplayName(name).toLowerCase().includes(query);
      return codeHit || labelHit;
    });
    return toItems(matched.slice(0, 4));
  }, [allDistrictNames, currentLocation, searchQuery]);

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
  const clearMapHighlight = useCallback((expectedPubId = null) => {
    setMapHighlightedPubId((current) => {
      if (!expectedPubId) return null;
      return current != null && String(current) === String(expectedPubId) ? null : current;
    });
  }, []);

  const closeCard = useCallback((expectedPubId = null) => {
    setSelectedPub((current) => {
      if (!expectedPubId) return null;
      if (current?.id == null) return current;
      return String(current.id) === String(expectedPubId) ? null : current;
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
    setMapHighlightedPubId(null);
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
    setMapHighlightedPubId(null);
    if (updateSearch) setSearchQuery(formatDistrictWithCode(districtName));
    fitFeature(feature);
  }, [fitFeature, hasUserInteractedRef]);

  const focusCameraOnPub = useCallback((pub) => {
    const lat = Number(pub?.lat);
    const lon = Number(pub?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !cameraRef.current) return;

    const targetZoom = ZOOM_LEVELS.PUB_SEARCH;
    mapZoomRef.current = targetZoom;
    try {
      cameraRef.current.easeTo({
        center: [lon, lat],
        zoom: targetZoom,
        duration: 700,
        easing: 'ease',
      });
    } catch (err) {
      console.warn('useMapInteraction: focusCameraOnPub failed', err?.message);
    }
  }, [cameraRef, mapZoomRef]);

  const selectPub = useCallback((pub, updateSearch = true, focusCamera = false) => {
    if (!pub) return;
    hasUserInteractedRef.current = true;
    setSelectedDistrictName(null);
    setSelectedPostcodeArea(null);
    setPubSelectionSeq((seq) => seq + 1);
    setSelectedPub(pub);
    setMapHighlightedPubId(pub.id);
    // Selecting a pub should focus the map/card state, not leave a sticky query.
    if (updateSearch) setSearchQuery('');
    if (focusCamera) focusCameraOnPub(pub);
    // Server/typeahead suggestions can reference a pub not yet in viewport `allPubs`. Toggles use
    // `allPubs.find` for baseline state and map updates — without this, visited/favourite can look
    // broken until a viewport fetch adds the row (feels like "wait for load").
    if (pub.id != null) {
      setAllPubs((current) => (current.some((p) => p.id === pub.id) ? current : [...current, pub]));
    }
  }, [focusCameraOnPub, hasUserInteractedRef, setAllPubs]);

  // ── Visited / favourite (optimistic, idempotent) ─────────────

  const { showToast } = useToast();
  const statsRefreshTimerRef = useRef(null);
  /** `${field}:${pubId}` → sequence number of the latest tap, so stale failures don't revert newer taps. */
  const latestWriteSeqRef = useRef(new Map());
  const writeSeqCounterRef = useRef(0);

  useEffect(() => () => {
    if (statsRefreshTimerRef.current) clearTimeout(statsRefreshTimerRef.current);
  }, []);

  const scheduleStatsRefresh = useCallback(() => {
    if (statsRefreshTimerRef.current) clearTimeout(statsRefreshTimerRef.current);
    statsRefreshTimerRef.current = setTimeout(() => {
      statsRefreshTimerRef.current = null;
      refreshUserStats();
    }, STATS_REFRESH_DELAY_MS);
  }, [refreshUserStats]);

  /** Update one flag on one pub in both the map list and the open card. */
  const applyPubFlag = useCallback((pubId, field, value) => {
    setAllPubs((current) => current.map((pub) => (
      pub.id === pubId && pub[field] !== value ? { ...pub, [field]: value } : pub
    )));
    setSelectedPub((current) => (
      current?.id === pubId && current[field] !== value ? { ...current, [field]: value } : current
    ));
  }, [setAllPubs]);

  const setPubFlag = useCallback(async (pubId, field, desired, saveFn) => {
    const key = `${field}:${pubId}`;
    const seq = ++writeSeqCounterRef.current;
    latestWriteSeqRef.current.set(key, seq);

    applyPubFlag(pubId, field, desired);
    try {
      await saveFn(pubId, desired);
      if (field === 'isVisited') scheduleStatsRefresh();
    } catch (err) {
      console.warn(`useMapInteraction: saving ${field} failed`, err?.message ?? err);
      // Only undo if no newer tap on this pub has happened since.
      if (latestWriteSeqRef.current.get(key) === seq) {
        applyPubFlag(pubId, field, !desired);
        showToast(SAVE_FAILED_MESSAGE);
      }
    } finally {
      if (latestWriteSeqRef.current.get(key) === seq) latestWriteSeqRef.current.delete(key);
    }
  }, [applyPubFlag, scheduleStatsRefresh, showToast]);

  const currentPubFlag = useCallback((pubId, field) => {
    const pub = selectedPub?.id === pubId ? selectedPub : allPubs.find((p) => p.id === pubId);
    return Boolean(pub?.[field]);
  }, [allPubs, selectedPub]);

  /**
   * Toggle visited, or pass `visited` to set it explicitly (drinks / reviews mark a pub
   * visited without toggling).
   */
  const handleToggleVisited = useCallback((pubId, visited) => {
    const desired = typeof visited === 'boolean' ? visited : !currentPubFlag(pubId, 'isVisited');
    return setPubFlag(pubId, 'isVisited', desired, setPubVisited);
  }, [currentPubFlag, setPubFlag]);

  const handleToggleFavorite = useCallback((pubId) => {
    const desired = !currentPubFlag(pubId, 'isFavorite');
    return setPubFlag(pubId, 'isFavorite', desired, setPubFavorite);
  }, [currentPubFlag, setPubFlag]);

  // Returning to the app: pick up visits/favourites changed on another device.
  useEffect(() => {
    let lastState = AppState.currentState;
    const sub = AppState.addEventListener('change', (next) => {
      const cameToForeground = lastState !== 'active' && next === 'active';
      lastState = next;
      if (!cameToForeground) return;
      reloadVisitedFavoriteSets()
        .then((sets) => {
          if (!sets) return;
          const pending = latestWriteSeqRef.current;
          const sync = (pub) => {
            if (!pub?.id) return pub;
            const isVisited = pending.has(`isVisited:${pub.id}`) ? pub.isVisited : sets.visitedSet.has(pub.id);
            const isFavorite = pending.has(`isFavorite:${pub.id}`) ? pub.isFavorite : sets.favoritesSet.has(pub.id);
            return isVisited === pub.isVisited && isFavorite === pub.isFavorite
              ? pub
              : { ...pub, isVisited, isFavorite };
          };
          setAllPubs((current) => {
            let changed = false;
            const next = current.map((pub) => {
              const synced = sync(pub);
              if (synced !== pub) changed = true;
              return synced;
            });
            return changed ? next : current;
          });
          setSelectedPub((current) => (current ? sync(current) : current));
        })
        .catch((err) => console.warn('useMapInteraction: visited/favourite reload failed', err?.message ?? err));
    });
    return () => sub.remove();
  }, [setAllPubs]);

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
    const pubFeature = features.find((f) => f?.properties?.pubId != null);
    if (!pubFeature) return;
    const pressedId = String(pubFeature.properties.pubId);
    const pub = allPubs.find((item) => String(item.id) === pressedId);
    if (pub) selectPub(pub, false);
  }, [allPubs, selectPub, hasUserInteractedRef]);

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

    const localPubMatch = rankPubsForQuery(allPubs, rawQuery, 1)[0];
    if (localPubMatch) { selectPub(localPubMatch, true, true); return; }

    try {
      const serverResults = await searchPubsByName(rawQuery.trim(), 1);
      if (serverResults?.length > 0) {
        const resolved = await resolvePubForSelection(serverResults[0]);
        selectPub(resolved, true, true);
      }
    } catch {
      // server search unavailable
    }
  }, [allPubs, allPostcodeAreaNames, searchQuery, selectDistrict, selectPostcodeArea, selectPub, rankPubsForQuery, resolvePubForSelection]);

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

  const handlePubSuggestionPress = useCallback(async (pub) => {
    setShowSuggestions(false);
    Keyboard.dismiss();
    const resolved = await resolvePubForSelection(pub);
    selectPub(resolved, true, true);
  }, [selectPub, resolvePubForSelection]);

  const dismissSearchSuggestions = useCallback(() => {
    setShowSuggestions(false);
    Keyboard.dismiss();
  }, []);

  // ── Effects ───────────────────────────────────────────────────

  // Keyboard tracking
  useEffect(() => {
    const keyboardShow = Keyboard.addListener('keyboardDidShow', (event) => {
      const end = event?.endCoordinates;
      const height = end?.height ?? 0;
      setKeyboardHeight(height);
      const top = end?.screenY != null
        ? end.screenY
        : Dimensions.get('window').height - height;
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
    const localResults = rankPubsForQuery(allPubs, searchQuery, 8);
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
          return rankPubsForQuery(merged, searchQuery, 8);
        });
      } catch {
        // keep local results on server failure
      }
    }, 300);

    return () => { if (pubSearchTimeoutRef.current) clearTimeout(pubSearchTimeoutRef.current); };
  }, [allPubs, searchQuery, showSuggestions, rankPubsForQuery]);

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
          setMapHighlightedPubId(null);
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

      const summonPubId = route.params?.summonPubId;
      if (summonPubId && String(summonPubId) !== processedSummonPubRef.current) {
        const id = String(summonPubId);
        processedSummonPubRef.current = id;

        (async () => {
          try {
            let pub = allPubs.find((item) => String(item.id) === id);
            if (!pub) {
              pub = await fetchPubById(id);
            }
            if (!pub) {
              processedSummonPubRef.current = null;
              return;
            }

            const lat = Number(pub.lat);
            const lon = Number(pub.lon);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              const viewport = approximateBoundsFromCenter(lat, lon, ZOOM_LEVELS.PUB_SEARCH);
              const buffered = expandBounds(viewport);
              if (buffered) requestViewportPubs(buffered);
            }

            selectPub(pub, false, true);
          } catch (err) {
            console.warn('useMapInteraction: summon pub deep link failed', err?.message);
            processedSummonPubRef.current = null;
          } finally {
            const { summonPubId: _omit, ...remainingParams } = route.params || {};
            navigation.setParams(remainingParams);
          }
        })();
      } else if (!summonPubId) {
        processedSummonPubRef.current = null;
      }
    }, [
      allPubs,
      navigation,
      requestViewportPubs,
      route.params,
      selectDistrict,
      selectPostcodeArea,
      selectPub,
      cameraRef,
      mapZoomRef,
      hasUserInteractedRef,
    ]),
  );

  return {
    selectedPub,
    setSelectedPub,
    pubSelectionSeq,
    mapHighlightedPubId,
    clearMapHighlight,
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
    dismissSearchSuggestions,
  };
}
