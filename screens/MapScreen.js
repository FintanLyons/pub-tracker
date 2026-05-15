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
  Animated,
  StyleSheet,
  Dimensions,
  BackHandler,
} from 'react-native';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map as MLRNMap,
} from '@maplibre/maplibre-react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { submitPubReport } from '../services/ReportService';
import SearchBar from '../components/SearchBar';
import SearchSuggestions from '../components/SearchSuggestions';
import DraggablePubCard from '../components/DraggablePubCard';
import PubReportFormModal from '../components/PubReportFormModal';
import FilterScreen from './FilterScreen';
import { LoadingContext } from '../contexts/LoadingContext';
import { useUserStats } from '../contexts/UserStatsContext';
import { useFilterState } from './map/hooks/useFilterState';
import { useImageSource } from './map/hooks/useImageSource';
import { useMapCamera } from './map/hooks/useMapCamera';
import { useViewportPubs } from './map/hooks/useViewportPubs';
import { useMapInteraction } from './map/hooks/useMapInteraction';
import { COLORS } from '../constants/theme';
import { pubInsideFeature } from './map/mapUtils';
import postcodeDistrictGeojson from '../data/geo/london_postcode_districts.min.json';
import postcodeAreaOutlinesGeojson from '../data/geo/london_postcode_areas.min.json';
import postcodeAreaLabelPointsGeojson from '../data/geo/london_postcode_area_label_points.min.json';
import { styles as baseStyles } from './map/mapStyles';
import { getOpeningStatus, isOpenPastMidnight } from '../utils/openingHours';
import {
  buildPostcodeAreaLayerCollection,
  buildPostcodeDistrictLabelPointCollection,
  buildPostcodeDistrictLayerCollection,
  buildPubFeatureCollection,
  DEFAULT_CAMERA,
  MAP_COMPLETION_STYLE,
  MAP_STYLE,
  ZOOM_LEVELS,
} from './map/layerUtils';

const PUB_ICON_VISITED = require('../assets/pub_marker_visited.png');
const PUB_ICON_UNVISITED = require('../assets/pub_marker_unvisited.png');
const PUB_ICON_SELECTED = require('../assets/pub_marker_selected.png');

/** Space between pub sheet top (peek) and bottom edge of location / flag FABs after lift. */
const MAP_FLOATING_CONTROLS_PEEK_CLEARANCE = 12;
/** Fade FABs out while the sheet is near-fullscreen; ramps in as it settles to peek. */
const MAP_CONTROLS_HIDE_PX = 20;
/** Map content sits above the tab bar, which already applies `insets.bottom`. Do not add full bottom inset here or controls float too high vs the SearchBar. */
const MAP_FLOATING_BUTTON_SIZE = 48;
const MAP_FLOATING_CONTROLS_BOTTOM_GAP = 10;
/** Expanded tap target around postcode area/district text labels. */
const POSTCODE_LABEL_HITBOX = { top: 22, right: 28, bottom: 22, left: 28 };

export default function MapScreen() {
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

  // ── Hooks ─────────────────────────────────────────────────────

  const {
    cameraRef,
    mapZoomRef,
    hasUserInteractedRef,
    currentLocation,
    currentLocationShape,
    fitFeature,
    fitBoundsObject,
    handleCurrentLocation,
  } = useMapCamera({ setIsLocationLoaded, isMapFocused: isFocused });

  const {
    allPubs,
    setAllPubs,
    requestViewportPubs,
    handleRegionChange,
    loadedPubBoundsRef,
  } = useViewportPubs({ isFocused, mapZoomRef });

  const {
    selectedFeatures,
    selectedOwnerships,
    yearRange,
    showOnlyFavorites,
    showOnlyAchievements,
    closingTimeMin,
    showFilterScreen,
    allOwnerships,
    availableYearRange,
    handleFilterApply,
    handleFilterPress,
    handleFilterClose,
  } = useFilterState(allPubs);

  const interaction = useMapInteraction({
    allPubs,
    setAllPubs,
    requestViewportPubs,
    loadedPubBoundsRef,
    cameraRef,
    mapZoomRef,
    hasUserInteractedRef,
    fitFeature,
    fitBoundsObject,
    currentLocation,
    postcodeAreaSummaries,
    refreshUserStats,
    navigation,
    route,
  });

  const {
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
    mapHighlightedPubId,
    clearMapHighlight,
    closeCard,
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
  } = interaction;

  // ── Memos (layer data + filtering) ────────────────────────────

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
      ) return false;
      if (hasFeatures && (!pub.features || !selectedFeatures.every((f) => pub.features.includes(f)))) return false;
      if (hasOwnerships && (!pub.ownership || !selectedOwnerships.includes(pub.ownership))) return false;
      if (hasYearRange) {
        const foundedYear = parseInt(pub.founded, 10);
        if (!Number.isFinite(foundedYear) || foundedYear < yearRange.min || foundedYear > yearRange.max) return false;
      }
      if (hasFavorites && pub.isFavorite !== true) return false;
      if (hasAchievements && (!pub.achievements || pub.achievements.length === 0)) return false;
      if (hasClosingTime) {
        if (closingTimeMin === 'open_now') {
          if (!getOpeningStatus(pub.opening_hours).isOpen) return false;
        } else if (closingTimeMin === 'past_midnight') {
          if (!isOpenPastMidnight(pub.opening_hours)) return false;
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

  // Deselect pub when it falls outside the active filter set.
  // Use functional setState + String(id) so a strict id mismatch (e.g. map feature vs row type)
  // cannot clear the sheet after an in-place update like toggling visited.
  useEffect(() => {
    setSelectedPub((current) => {
      if (!current?.id) return current;
      const idStr = String(current.id);
      if (!filteredPubs.some((pub) => String(pub.id) === idStr)) return null;
      return current;
    });
  }, [filteredPubs, setSelectedPub]);

  const pubFeatureCollection = useMemo(
    () => buildPubFeatureCollection(filteredPubs, mapHighlightedPubId),
    [filteredPubs, mapHighlightedPubId],
  );

  const districtStatsMap = useMemo(() => {
    if (!allPubs.length) return null;
    const statsMap = new Map();
    allPubs.forEach((pub) => {
      const district = typeof pub.area === 'string' ? pub.area.trim().toLowerCase() : '';
      if (!district) return;
      let entry = statsMap.get(district);
      if (!entry) { entry = { total: 0, visited: 0 }; statsMap.set(district, entry); }
      entry.total += 1;
      if (pub.isVisited) entry.visited += 1;
    });
    return statsMap;
  }, [allPubs]);

  const postcodeAreaLayerFeatures = useMemo(
    () => buildPostcodeAreaLayerCollection(postcodeAreaOutlinesGeojson, postcodeAreaSummaries),
    [postcodeAreaSummaries],
  );

  const postcodeAreaLabelFeatures = useMemo(
    () => buildPostcodeAreaLayerCollection(postcodeAreaLabelPointsGeojson, postcodeAreaSummaries),
    [postcodeAreaSummaries],
  );

  const postcodeDistrictLayerFeatures = useMemo(
    () => buildPostcodeDistrictLayerCollection(
      postcodeDistrictGeojson,
      selectedPostcodeArea,
      selectedDistrictName,
      districtStatsMap,
    ),
    [selectedPostcodeArea, selectedDistrictName, districtStatsMap],
  );

  const postcodeDistrictLabelFeatures = useMemo(
    () => buildPostcodeDistrictLabelPointCollection(postcodeDistrictGeojson),
    [],
  );

  // ── Sheet animation ───────────────────────────────────────────

  const [mapAreaHeight, setMapAreaHeight] = useState(Dimensions.get('window').height);
  const [collapseSheetRequest, setCollapseSheetRequest] = useState(0);

  const sheetTranslateYRef = useRef(null);
  if (sheetTranslateYRef.current == null) {
    sheetTranslateYRef.current = new Animated.Value(Dimensions.get('window').height);
  }
  const sheetTranslateY = sheetTranslateYRef.current;

  const mapSheetMetrics = useMemo(() => {
    const height = mapAreaHeight > 0 ? mapAreaHeight : Dimensions.get('window').height;
    const peek = height * 0.33;
    const fullHeight = Math.max(height, peek + 1);
    return { peek, collapsedY: fullHeight - peek, hiddenY: fullHeight };
  }, [mapAreaHeight]);

  useEffect(() => {
    if (!selectedPub) {
      sheetTranslateY.stopAnimation();
      sheetTranslateY.setValue(mapSheetMetrics.hiddenY);
    }
  }, [selectedPub, mapSheetMetrics.hiddenY, sheetTranslateY]);

  // Android back behavior on map:
  // 1) if search suggestions are open, close them (or let system close keyboard first)
  // 2) if pub sheet is open, step: expanded -> collapsed -> hidden
  // 3) else if area/district/search is active, clear it and return to plain map
  // 4) else fall through to default navigation/app behavior
  useEffect(() => {
    if (!isFocused) return undefined;
    const onHardwareBackPress = () => {
      if (showSuggestions) {
        if (keyboardHeight > 0) {
          return false;
        }
        dismissSearchSuggestions();
        return true;
      }

      if (selectedPub) {
        sheetTranslateY.stopAnimation((currentY) => {
          const collapsedY = mapSheetMetrics.collapsedY;
          const expandedThreshold = collapsedY - 24;
          if (currentY <= expandedThreshold) {
            setCollapseSheetRequest((current) => current + 1);
            return;
          }
          clearMapHighlight(selectedPub.id);
          closeCard(selectedPub.id);
        });
        return true;
      }

      const hasActiveSearchState = Boolean(
        selectedPostcodeArea
        || selectedDistrictName
        || searchQuery.trim().length > 0,
      );
      if (hasActiveSearchState) {
        clearSearch();
        return true;
      }

      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBackPress);
    return () => sub.remove();
  }, [
    isFocused,
    showSuggestions,
    keyboardHeight,
    dismissSearchSuggestions,
    selectedPub,
    mapSheetMetrics.collapsedY,
    sheetTranslateY,
    mapHighlightedPubId,
    clearMapHighlight,
    closeCard,
    selectedPostcodeArea,
    selectedDistrictName,
    searchQuery,
    clearSearch,
  ]);

  const floatingControlsStyle = useMemo(() => {
    const { peek, collapsedY, hiddenY } = mapSheetMetrics;
    const bottomGap = MAP_FLOATING_CONTROLS_BOTTOM_GAP;
    const liftPeek = Math.max(
      0,
      peek + MAP_FLOATING_CONTROLS_PEEK_CLEARANCE - bottomGap,
    );
    const translateY = sheetTranslateY.interpolate({
      inputRange: [0, collapsedY, hiddenY],
      outputRange: [-liftPeek, -liftPeek, 0],
      extrapolate: 'clamp',
    });
    const hideThreshold =
      collapsedY > MAP_CONTROLS_HIDE_PX + 2
        ? collapsedY - MAP_CONTROLS_HIDE_PX
        : collapsedY * 0.35;
    const opacity = sheetTranslateY.interpolate({
      inputRange: [0, hideThreshold, collapsedY, hiddenY],
      outputRange: [0, 0, 1, 1],
      extrapolate: 'clamp',
    });
    return { opacity, transform: [{ translateY }] };
  }, [mapSheetMetrics, sheetTranslateY]);

  const mapControlsBaseBottom = MAP_FLOATING_CONTROLS_BOTTOM_GAP;
  const feedbackToastBottom =
    mapControlsBaseBottom + MAP_FLOATING_BUTTON_SIZE + 12;

  // ── Missing pub modal ─────────────────────────────────────────

  const [isMissingPubModalVisible, setIsMissingPubModalVisible] = useState(false);
  const [isMissingPubSuccessVisible, setIsMissingPubSuccessVisible] = useState(false);

  const openMissingPubModal = useCallback(() => {
    setIsMissingPubModalVisible(true);
  }, []);

  const closeMissingPubModal = useCallback(() => {
    setIsMissingPubModalVisible(false);
  }, []);

  const handleMissingPubSubmit = useCallback(async (payload) => {
    await submitPubReport({
      reportType: 'missing_pub',
      pubId: null,
      pubName: payload.pubName,
      pubArea: payload.address || 'Unknown Area',
      chainOrIndependent: payload.chainOrIndependent,
      founded: payload.founded,
      address: payload.address,
      website: payload.website,
      phone: payload.phone,
      closingTime: payload.closingTime,
      history: payload.history,
      features: payload.features,
      imageUris: payload.imageUris,
    });
  }, []);

  // ── Loading gate ──────────────────────────────────────────────

  useEffect(() => {
    setIsInitialPubsLoaded?.(true);
  }, [setIsInitialPubsLoaded]);

  // ── Render ────────────────────────────────────────────────────

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
        onRegionDidChange={handleRegionChange}
        onDidFailLoadingMap={() => console.warn('MapLibre: map failed to load')}
      >
        <Camera ref={cameraRef} initialViewState={DEFAULT_CAMERA} minZoom={8.5} maxZoom={17.5} />
        <Images
          images={{
            pubVisited: PUB_ICON_VISITED,
            pubUnvisited: PUB_ICON_UNVISITED,
            pubSelected: PUB_ICON_SELECTED,
          }}
        />

        <GeoJSONSource id="postcode-areas" data={postcodeAreaLayerFeatures}>
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

        <GeoJSONSource id="postcode-districts" data={postcodeDistrictLayerFeatures}>
          <Layer
            type="fill"
            id="postcode-district-fill"
            minzoom={ZOOM_LEVELS.DISTRICTS_MIN}
            paint={{
              'fill-color': ['get', 'fillColor'],
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
        </GeoJSONSource>

        <GeoJSONSource
          id="postcode-area-label-points"
          data={postcodeAreaLabelFeatures}
          onPress={handlePostcodeAreaLayerPress}
          hitbox={POSTCODE_LABEL_HITBOX}
        >
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
          id="postcode-district-label-points"
          data={postcodeDistrictLabelFeatures}
          onPress={handlePostcodeDistrictLayerPress}
          hitbox={POSTCODE_LABEL_HITBOX}
        >
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
              (selectedPostcodeArea || selectedDistrictName)
                ? ZOOM_LEVELS.DISTRICTS_MIN
                : ZOOM_LEVELS.PUBS_MIN
            }
            layout={{
              'icon-image': [
                'case',
                ['boolean', ['get', 'isSelected'], false],
                'pubSelected',
                ['boolean', ['get', 'isVisited'], false],
                'pubVisited',
                'pubUnvisited',
              ],
              'icon-size': [
                'interpolate',
                ['linear'],
                ['zoom'],
                ZOOM_LEVELS.DISTRICTS_MIN,
                ['case', ['boolean', ['get', 'isSelected'], false], 0.075, 0.06],
                ZOOM_LEVELS.PUBS_MIN,
                ['case', ['boolean', ['get', 'isSelected'], false], 0.13, 0.10],
                17.5,
                ['case', ['boolean', ['get', 'isSelected'], false], 0.15, 0.12],
              ],
              'icon-allow-overlap': true,
              'icon-ignore-placement': true,
              'icon-anchor': 'bottom',
            }}
          />
        </GeoJSONSource>

        {currentLocationShape && (
          <GeoJSONSource
            id="current-location"
            data={currentLocationShape}
            onPress={handleCurrentLocation}
          >
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
        onDismiss={dismissSearchSuggestions}
        keyboardHeight={keyboardHeight}
        keyboardTop={keyboardTop}
      />

      <FilterScreen
        visible={showFilterScreen}
        onClose={handleFilterClose}
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
        collapseRequest={collapseSheetRequest}
        onCloseStart={clearMapHighlight}
        onClose={closeCard}
        onToggleVisited={handleToggleVisited}
        onToggleFavorite={handleToggleFavorite}
        getImageSource={getImageSource}
      />

      <Animated.View
        pointerEvents="box-none"
        renderToHardwareTextureAndroid
        style={[screenStyles.floatingLeft, { bottom: mapControlsBaseBottom }, floatingControlsStyle]}
      >
        <TouchableOpacity style={baseStyles.mapFloatingButton} onPress={openMissingPubModal}>
          <MaterialCommunityIcons name="flag-plus-outline" size={24} color={COLORS.amber} />
        </TouchableOpacity>
      </Animated.View>

      <Animated.View
        pointerEvents="box-none"
        renderToHardwareTextureAndroid
        style={[screenStyles.floatingRight, { bottom: mapControlsBaseBottom }, floatingControlsStyle]}
      >
        <TouchableOpacity style={baseStyles.mapFloatingButton} onPress={handleCurrentLocation}>
          <MaterialCommunityIcons name="crosshairs-gps" size={24} color={COLORS.amber} />
        </TouchableOpacity>
      </Animated.View>

      <PubReportFormModal
        visible={isMissingPubModalVisible}
        onClose={closeMissingPubModal}
        mode="missing_pub"
        onSubmit={handleMissingPubSubmit}
        onSuccess={() => setIsMissingPubSuccessVisible(true)}
      />

      {isMissingPubSuccessVisible && (
        <Animated.View
          style={[
            baseStyles.feedbackToast,
            screenStyles.feedbackToast,
            { bottom: feedbackToastBottom },
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
    zIndex: 1200,
    elevation: 14,
  },
});
