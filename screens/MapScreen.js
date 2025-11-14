import React, { useEffect, useState, useRef, useCallback, useContext, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  Dimensions,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
  InteractionManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import MapView, { Marker, Callout } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  fetchLondonPubs,
  fetchBoroughSummaries,
  togglePubVisited,
  togglePubFavorite,
} from '../services/PubService';
import { submitMissingPubReport } from '../services/ReportService';
import {
  primeProfileStatsFromPubs,
  updateCachedProfileLocation,
} from '../services/ProfileStatsCache';
import { getCurrentUserSecure } from '../services/SecureAuthService';
import { syncUserStats } from '../services/UserService';
import { getFriendsLeaderboard, getPendingFriendRequests } from '../services/FriendsService';
import { getUserLeagues, getLeagueLeaderboard } from '../services/LeagueService';
import { cacheLeaderboardData } from '../services/LeaderboardCache';
import PintGlassIcon from '../components/PintGlassIcon';
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
  BOROUGH_ENTER_DELTA,
  BOROUGH_EXIT_DELTA,
  AREA_ENTER_DELTA,
  AREA_EXIT_DELTA,
  BOROUGH_LIMIT,
  REGION_LATITUDE_EPSILON,
  REGION_LONGITUDE_EPSILON,
  LOCATION_MIN_DISTANCE_METERS,
  LOCATION_UPDATE_MIN_INTERVAL_MS,
  LOCATION_HEADING_EPSILON_DEGREES,
  LOCATION_WATCH_DISTANCE_METERS,
  COLORS,
} from './map/constants';
import {
  serializeBoroughSummaries,
  distanceBetween,
  calculateDistanceMeters,
  getAreaCenter,
  interpolateColor,
} from './map/utils';
import { useAreaStats } from './map/hooks/useAreaStats';
import { useNearestAreaKeys } from './map/hooks/useNearestAreas';
import { useViewportPubs } from './map/hooks/useViewportPubs';

const AMBER = COLORS.amber;
const MEDIUM_GREY = COLORS.grey;
const DARK_CHARCOAL = COLORS.charcoal;

const customMapStyle = [
  {
    "elementType": "geometry",
    "stylers": [
      {
        "lightness": 10
      },
      {
        "saturation": -10
      }
    ]
  },
  {
    "elementType": "labels.text.fill",
    "stylers": [
      {
        "saturation": -20
      },
      {
        "lightness": 20
      }
    ]
  },
  {
    "elementType": "labels.text.stroke",
    "stylers": [
      {
        "lightness": 30
      }
    ]
  },
  {
    "featureType": "poi",
    "elementType": "all",
    "stylers": [
      {
        "visibility": "off"
      }
    ]
  },
  {
    "featureType": "poi.park",
    "elementType": "all",
    "stylers": [
      {
        "visibility": "on"
      }
    ]
  },
  {
    "featureType": "transit.station",
    "elementType": "labels.text",
    "stylers": [
      {
        "visibility": "on"
      }
    ]
  },
  {
    "featureType": "transit.station",
    "elementType": "labels.icon",
    "stylers": [
      {
        "visibility": "on"
      }
    ]
  },
  {
    "featureType": "road",
    "elementType": "geometry",
    "stylers": [
      {
        "lightness": 25
      },
      {
        "saturation": -15
      }
    ]
  },
  {
    "featureType": "road.highway",
    "elementType": "geometry",
    "stylers": [
      {
        "lightness": 20
      },
      {
        "saturation": -20
      }
    ]
  },
  {
    "featureType": "water",
    "elementType": "geometry",
    "stylers": [
      {
        "hue": "#5c97bf"
      },
      {
        "lightness": 35
      },
      {
        "saturation": -15
      }
    ]
  },
  {
    "featureType": "landscape",
    "elementType": "geometry",
    "stylers": [
      {
        "lightness": 15
      },
      {
        "saturation": -12
      }
    ]
  }
];

const BoroughMarker = React.memo(
  ({ summary, completion, onPress, tracksViewChanges }) => {
    if (!summary?.center) {
      return null;
    }

    const handlePress = () => {
      onPress(summary);
    };

    return (
      <Marker
        coordinate={{
          latitude: summary.center.latitude,
          longitude: summary.center.longitude,
        }}
        anchor={{ x: 0.5, y: 0.5 }}
        tracksViewChanges={tracksViewChanges}
        onPress={handlePress}
      >
        <Callout tooltip>
          <View style={styles.boroughCallout}>
            <Text style={styles.boroughCalloutText}>{summary.borough}</Text>
          </View>
        </Callout>
      </Marker>
    );
  },
  (prev, next) =>
    prev.tracksViewChanges === next.tracksViewChanges &&
    prev.summary?.borough === next.summary?.borough &&
    prev.summary?.center?.latitude === next.summary?.center?.latitude &&
    prev.summary?.center?.longitude === next.summary?.center?.longitude &&
    prev.completion === next.completion
);

const PubMarker = React.memo(
  ({ pub, onPress }) => {
    if (!pub || typeof pub.lat !== 'number' || typeof pub.lon !== 'number') {
      return null;
    }

    const handlePress = () => {
      onPress(pub);
    };

    return (
      <Marker
        coordinate={{ latitude: pub.lat, longitude: pub.lon }}
        onPress={handlePress}
      >
        <View style={styles.markerContainer}>
          <PintGlassIcon
            size={28}
            color={pub.isVisited ? AMBER : MEDIUM_GREY}
          />
        </View>
      </Marker>
    );
  },
  (prev, next) => {
    // Only re-render if pub id, coordinates, or visited status changes
    return (
      prev.pub?.id === next.pub?.id &&
      prev.pub?.lat === next.pub?.lat &&
      prev.pub?.lon === next.pub?.lon &&
      prev.pub?.isVisited === next.pub?.isVisited &&
      prev.onPress === next.onPress
    );
  }
);

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { isLocationLoaded, setIsLocationLoaded, setIsInitialPubsLoaded } = useContext(LoadingContext);
  const [allPubs, setAllPubs] = useState([]); // Store unfiltered pubs
  const [selectedPub, setSelectedPub] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Start with null region - will be set to user location once available
  // This prevents loading pubs for the entire London region initially
  const [mapRegion, setMapRegion] = useState(null);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [hasSetInitialRegion, setHasSetInitialRegion] = useState(false);
  const [markerMode, setMarkerMode] = useState(MARKER_MODES.BOROUGHS);
  const [heading, setHeading] = useState(0);
  const [showFilterScreen, setShowFilterScreen] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [selectedOwnerships, setSelectedOwnerships] = useState([]);
  const [yearRange, setYearRange] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null); // Filter by area name
  const [focusedBorough, setFocusedBorough] = useState(null);
  const [showOnlyFavorites, setShowOnlyFavorites] = useState(false);
  const [showOnlyAchievements, setShowOnlyAchievements] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState(0);
  const [isMissingPubModalVisible, setIsMissingPubModalVisible] = useState(false);
  const [isSubmittingMissingPub, setIsSubmittingMissingPub] = useState(false);
  const [missingPubError, setMissingPubError] = useState(null);
  const [isMissingPubSuccessVisible, setIsMissingPubSuccessVisible] = useState(false);
  const clearedAreaRef = useRef(null); // Track which area was explicitly cleared (to prevent re-applying)
  const clearedBoroughRef = useRef(null);
  const mapRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  const isNavigatingRef = useRef(false); // Track when doing programmatic navigation
  const lastLocationUpdateRef = useRef(0); // Track last location update time for throttling
  const regionChangeTimeoutRef = useRef(null); // Track region change throttling timeout
  // Start with null - will be set when user location is available
  const lastCommittedRegionRef = useRef(null);
  const lastLocationRef = useRef(null);
  const lastHeadingRef = useRef(null);
  const [boroughSummaries, setBoroughSummaries] = useState([]);
  const [isLoadingBoroughs, setIsLoadingBoroughs] = useState(true);
  const [activeBoroughs, setActiveBoroughs] = useState([]);
  const [shouldTrackBoroughViews, setShouldTrackBoroughViews] = useState(true);
  const screenHeight = Dimensions.get('window').height;
  const cardHeight = screenHeight * 0.33;
  const floatingButtonBottom = useMemo(
    () => insets.bottom - 24 + (selectedPub ? cardHeight - 24 : 0),
    [insets.bottom, selectedPub, cardHeight]
  );
  const { areaStatsMap, allAreas, calculateAreaStats } = useAreaStats(allPubs);
  const allBoroughNames = useMemo(() => {
    const boroughSet = new Set();

    if (Array.isArray(boroughSummaries)) {
      boroughSummaries.forEach((summary) => {
        if (summary?.borough) {
          boroughSet.add(summary.borough);
        }
      });
    }

    allPubs.forEach((pub) => {
      if (typeof pub?.borough === 'string' && pub.borough.trim().length > 0) {
        boroughSet.add(pub.borough.trim());
      }
    });

    return Array.from(boroughSet).sort((a, b) => a.localeCompare(b));
  }, [boroughSummaries, allPubs]);

  // Track if initial pubs have been loaded
  const initialPubsLoadedRef = useRef(false);

  // Callback for when viewport pubs are loaded
  const handleViewportPubsLoaded = useCallback((pubs) => {
    if (Array.isArray(pubs) && pubs.length > 0) {
      mergePubs(pubs);
      
      // Mark initial pubs as loaded (only once)
      if (!initialPubsLoadedRef.current && setIsInitialPubsLoaded) {
        initialPubsLoadedRef.current = true;
        setIsInitialPubsLoaded(true);
      }
    }
  }, [mergePubs, setIsInitialPubsLoaded]);

  // Use viewport-based loading instead of loading all pubs
  // Only start loading once we have a region (user location or fallback)
  const { loadPubsForRegion: loadPubsForViewportRegion, isLoading: isLoadingViewportPubs } = useViewportPubs(
    mapRegion || lastCommittedRegionRef.current || null,
    handleViewportPubsLoaded
  );
  
  // If viewport loading completes with no pubs (error case), still mark as loaded
  useEffect(() => {
    if (!isLoadingViewportPubs && !initialPubsLoadedRef.current && setIsInitialPubsLoaded) {
      // Give it a moment in case pubs are still loading
      const timer = setTimeout(() => {
        if (!initialPubsLoadedRef.current) {
          initialPubsLoadedRef.current = true;
          setIsInitialPubsLoaded(true);
        }
      }, 2000); // Wait 2 seconds max for initial load
      
      return () => clearTimeout(timer);
    }
  }, [isLoadingViewportPubs, setIsInitialPubsLoaded]);

  useEffect(() => {
    let isCancelled = false;

    const loadBoroughSummaries = async () => {
      try {
        setIsLoadingBoroughs(true);
        const summaries = await fetchBoroughSummaries();
        if (!isCancelled) {
          setBoroughSummaries((prev) => {
            const nextArray = Array.isArray(summaries) ? summaries : [];
            const prevKey = serializeBoroughSummaries(prev);
            const nextKey = serializeBoroughSummaries(nextArray);
            if (prevKey === nextKey) {
              return prev;
            }
            return nextArray;
          });
        }
      } catch (error) {
        console.error('Error loading borough summaries:', error);
        if (!isCancelled) {
          setBoroughSummaries([]);
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingBoroughs(false);
        }
      }
    };

    // Load all pubs in background for accurate total counts
    // Store in ProfileStatsCache (not React state) to avoid performance issues
    // Only viewport pubs are kept in allPubs state for fast UI
    const loadAllPubsInBackground = async () => {
      try {
        // Use InteractionManager to defer this until after initial render
        InteractionManager.runAfterInteractions(async () => {
          if (isCancelled) return;
          
          // Fetch all pubs without bounds to get complete dataset
          const allPubsData = await fetchLondonPubs();
          if (!isCancelled && Array.isArray(allPubsData) && allPubsData.length > 0) {
            // Store all pubs in ProfileStatsCache for accurate counts
            // Do NOT merge into allPubs state - that would cause performance issues
            // Only viewport pubs should be in React state (handled by viewport loading)
            primeProfileStatsFromPubs(allPubsData);
          }
        });
      } catch (error) {
        console.error('Error loading all pubs in background:', error);
      }
    };

    // Preload leaderboard data in background for fast LeaderboardScreen loading
    const preloadLeaderboardData = async () => {
      try {
        // Use InteractionManager to defer this until after initial render
        InteractionManager.runAfterInteractions(async () => {
          if (isCancelled) return;
          
          try {
            const user = await getCurrentUserSecure();
            if (!user || !user.id) {
              return; // Not logged in, skip leaderboard preload
            }

            // Sync user stats first
            await syncUserStats(user.id);

            // Load all leaderboard data
            const [friends, pendingRequests, leagues] = await Promise.all([
              getFriendsLeaderboard(user.id),
              getPendingFriendRequests(user.id),
              getUserLeagues(user.id),
            ]);

            // Load first league's leaderboard if available
            let leagueLeaderboard = [];
            if (leagues && leagues.length > 0) {
              try {
                leagueLeaderboard = await getLeagueLeaderboard(leagues[0].id);
              } catch (error) {
                console.warn('Error loading first league leaderboard:', error);
              }
            }

            // Cache the leaderboard data
            cacheLeaderboardData({
              friendsLeaderboard: friends || [],
              pendingRequestsCount: pendingRequests?.length || 0,
              leagues: leagues || [],
              leagueLeaderboard: leagueLeaderboard || [],
              selectedLeagueId: leagues && leagues.length > 0 ? leagues[0].id : null,
            });
          } catch (error) {
            console.warn('Error preloading leaderboard data:', error);
            // Don't throw - this is background preloading, failures are acceptable
          }
        });
      } catch (error) {
        console.warn('Error setting up leaderboard preload:', error);
      }
    };

    loadBoroughSummaries();
    loadAllPubsInBackground();
    preloadLeaderboardData();

    return () => {
      isCancelled = true;
    };
  }, [mergePubs]);

  useEffect(() => {
    if (boroughSummaries.length === 0) {
      setShouldTrackBoroughViews(true);
      return undefined;
    }

    setShouldTrackBoroughViews(true);
    const timer = setTimeout(() => {
      setShouldTrackBoroughViews(false);
    }, 600);

    return () => clearTimeout(timer);
  }, [boroughSummaries]);

  useEffect(() => {
    const region = mapRegion || lastCommittedRegionRef.current;
    if (!region || !Array.isArray(boroughSummaries) || boroughSummaries.length === 0) {
      setActiveBoroughs(focusedBorough ? [focusedBorough] : []);
      return;
    }

    const center = {
      latitude: region.latitude,
      longitude: region.longitude,
    };

    const nearest = boroughSummaries
      .filter(
        (summary) =>
          summary?.center &&
          Number.isFinite(summary.center.latitude) &&
          Number.isFinite(summary.center.longitude)
      )
      .map((summary) => ({
        borough: summary.borough,
        distance: distanceBetween(summary.center, center),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, BOROUGH_LIMIT)
      .map((item) => item.borough);

    if (focusedBorough && nearest.indexOf(focusedBorough) === -1) {
      nearest.unshift(focusedBorough);
    }

    setActiveBoroughs(nearest);
  }, [mapRegion, boroughSummaries, focusedBorough]);

  const nearestAreaKeys = useNearestAreaKeys(
    mapRegion,
    areaStatsMap,
    activeBoroughs,
    lastCommittedRegionRef
  );

  useEffect(() => {
    const setupLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // Use Lowest accuracy for initial load to get cached location quickly
          // This significantly speeds up the initial load time
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Lowest,
            maximumAge: 60000, // Accept cached location up to 60 seconds old
          });
          const userLocation = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };
          setCurrentLocation(userLocation);
          updateCachedProfileLocation(userLocation);
          lastLocationUpdateRef.current = Date.now();
          lastLocationRef.current = userLocation;
          const initialHeading = location.coords.heading;
          if (typeof initialHeading === 'number' && !Number.isNaN(initialHeading)) {
            lastHeadingRef.current = initialHeading;
            setHeading(initialHeading);
          }
          
          // Set initial map region to user's location with smaller zoom (fewer pubs to load)
          const initialRegion = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.02, // Much smaller - shows ~2km area instead of ~10km
            longitudeDelta: 0.02,
          };
          
          // Set region state first (this will trigger viewport loading)
          setMapRegion(initialRegion);
          setHasSetInitialRegion(true);
          commitMapRegion(initialRegion);
          
          // Mark as navigating to prevent onRegionChangeComplete from overriding
          isNavigatingRef.current = true;
          
          // Animate to user location to ensure map is centered
          if (mapRef.current) {
            mapRef.current.animateToRegion(initialRegion, 0);
          }
          
          // Reset flag after brief delay
          setTimeout(() => {
            isNavigatingRef.current = false;
          }, 200);
          
          setIsLocationLoaded(true);
          
          // Start watching position with better accuracy for updates
          // Throttled to update on meaningful movement to reduce re-renders
          locationSubscriptionRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: LOCATION_UPDATE_MIN_INTERVAL_MS,
              distanceInterval: LOCATION_WATCH_DISTANCE_METERS,
            },
            (location) => {
              const now = Date.now();
              if (now - lastLocationUpdateRef.current < LOCATION_UPDATE_MIN_INTERVAL_MS) {
                return; // Skip update if too soon
              }

              const nextLocation = {
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              };

              const lastLocation = lastLocationRef.current;
              const distanceMoved = calculateDistanceMeters(lastLocation, nextLocation);
              if (lastLocation && distanceMoved < LOCATION_MIN_DISTANCE_METERS) {
                return; // Skip tiny oscillations
              }

              lastLocationUpdateRef.current = now;
              lastLocationRef.current = nextLocation;
              setCurrentLocation(nextLocation);

              const headingValue = location.coords.heading;
              if (
                typeof headingValue === 'number' &&
                !Number.isNaN(headingValue) &&
                ((lastHeadingRef.current === null || lastHeadingRef.current === undefined) ||
                  Math.abs(headingValue - lastHeadingRef.current) >= LOCATION_HEADING_EPSILON_DEGREES)
              ) {
                lastHeadingRef.current = headingValue;
                setHeading(headingValue);
              }
            }
          );
        } else {
          // Permission denied, use smaller region around central London as fallback
          setIsLocationLoaded(true);
          if (!hasSetInitialRegion) {
            const fallbackRegion = {
              latitude: 51.5074,
              longitude: -0.1278,
              latitudeDelta: 0.02, // Small region around central London
              longitudeDelta: 0.02,
            };
            setMapRegion(fallbackRegion);
            setHasSetInitialRegion(true);
            commitMapRegion(fallbackRegion);
            
            if (mapRef.current) {
              mapRef.current.animateToRegion(fallbackRegion, 0);
            }
          }
        }
      } catch (error) {
        console.error('Location setup error:', error);
        // On error, use smaller region around central London as fallback
        setIsLocationLoaded(true);
        if (!hasSetInitialRegion) {
          const fallbackRegion = {
            latitude: 51.5074,
            longitude: -0.1278,
            latitudeDelta: 0.02, // Small region around central London
            longitudeDelta: 0.02,
          };
          setMapRegion(fallbackRegion);
          setHasSetInitialRegion(true);
          commitMapRegion(fallbackRegion);
          
          if (mapRef.current) {
            mapRef.current.animateToRegion(fallbackRegion, 0);
          }
        }
      }
    };
    
    setupLocation();

    // Keyboard event listeners
    const keyboardWillShow = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
      // Use screenY if available, otherwise calculate from screen height
      const top = e.endCoordinates.screenY !== undefined 
        ? e.endCoordinates.screenY 
        : Dimensions.get('window').height - e.endCoordinates.height;
      setKeyboardTop(top);
    });
    const keyboardWillHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
      setKeyboardTop(0);
    });
    
    return () => {
      locationSubscriptionRef.current?.remove();
      keyboardWillShow.remove();
      keyboardWillHide.remove();
      // Clean up region change timeout
      if (regionChangeTimeoutRef.current) {
        clearTimeout(regionChangeTimeoutRef.current);
      }
    };
  }, [commitMapRegion]);

  const handlePubPress = useCallback((pub) => {
    setSelectedPub(pub);
  }, []);

  const handleToggleVisited = useCallback(async (pubId) => {
    // Store original state for potential rollback
    const originalPubs = [...allPubs];
    const originalSelectedPub = selectedPub ? { ...selectedPub } : null;
    
    // Optimistically update UI immediately for instant feedback
    const pubToUpdate = allPubs.find(p => p.id === pubId);
    const newVisitedState = !pubToUpdate?.isVisited;
    
    // Update selectedPub immediately if it's the one being toggled
    if (selectedPub?.id === pubId) {
      setSelectedPub({ ...selectedPub, isVisited: newVisitedState });
    }
    
    // Update allPubs immediately
    const updatedAllPubs = allPubs.map(p => 
      p.id === pubId ? { ...p, isVisited: newVisitedState } : p
    );
    setAllPubs(updatedAllPubs);
    
    // Persist to storage in the background (no need to refetch all pubs)
    try {
      await togglePubVisited(pubId);
    } catch (error) {
      console.error('Error toggling visited status:', error);
      // Revert optimistic update on error
      setAllPubs(originalPubs);
      if (originalSelectedPub?.id === pubId) {
        setSelectedPub(originalSelectedPub);
      }
    }
  }, [allPubs, selectedPub]);

  const handleToggleFavorite = useCallback(async (pubId) => {
    // Store original state for potential rollback
    const originalPubs = [...allPubs];
    const originalSelectedPub = selectedPub ? { ...selectedPub } : null;
    
    // Optimistically update UI immediately for instant feedback
    const pubToUpdate = allPubs.find(p => p.id === pubId);
    const newFavoriteState = !pubToUpdate?.isFavorite;
    
    // Update selectedPub immediately if it's the one being toggled
    if (selectedPub?.id === pubId) {
      setSelectedPub({ ...selectedPub, isFavorite: newFavoriteState });
    }
    
    // Update allPubs immediately
    const updatedAllPubs = allPubs.map(p => 
      p.id === pubId ? { ...p, isFavorite: newFavoriteState } : p
    );
    setAllPubs(updatedAllPubs);
    
    // Persist to storage in the background (no need to refetch all pubs)
    try {
      await togglePubFavorite(pubId);
    } catch (error) {
      console.error('Error toggling favorite status:', error);
      // Revert optimistic update on error
      setAllPubs(originalPubs);
      if (originalSelectedPub?.id === pubId) {
        setSelectedPub(originalSelectedPub);
      }
    }
  }, [allPubs, selectedPub]);

  // Extract all unique features from pubs - memoized for performance
  const allFeatures = useMemo(() => {
    const featureSet = new Set();
    allPubs.forEach(pub => {
      if (pub.features && Array.isArray(pub.features)) {
        pub.features.forEach(feature => featureSet.add(feature));
      }
    });
    return Array.from(featureSet).sort();
  }, [allPubs]);

  // Extract all unique ownerships from pubs, sorted by count (most to least) - memoized for performance
  const allOwnerships = useMemo(() => {
    const ownershipCounts = {};
    allPubs.forEach(pub => {
      if (pub.ownership && pub.ownership.trim()) {
        const ownership = pub.ownership;
        ownershipCounts[ownership] = (ownershipCounts[ownership] || 0) + 1;
      }
    });
    
    // Sort by count (descending), then alphabetically
    return Object.entries(ownershipCounts)
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1]; // Sort by count descending
        }
        return a[0].localeCompare(b[0]); // Then alphabetically
      })
      .map(([ownership]) => ownership);
  }, [allPubs]);

  // Get min and max founded years from pubs - memoized for performance
  const availableYearRange = useMemo(() => {
    const years = [];
    allPubs.forEach(pub => {
      if (pub.founded) {
        const year = parseInt(pub.founded, 10);
        if (!isNaN(year)) {
          years.push(year);
        }
      }
    });
    if (years.length === 0) {
      return { min: 1800, max: 2025 };
    }
    return {
      min: Math.min(...years),
      max: Math.max(...years)
    };
  }, [allPubs]);

  // Apply filters to pubs (features, ownerships, year range, area, and favorites) - memoized for performance
  // Single-pass filtering optimized with early returns
  const filteredPubs = useMemo(() => {
    if (!allPubs || allPubs.length === 0) {
      return [];
    }

    const basePubs = allPubs.filter((pub) => {
      const areaName = pub.area ? pub.area.trim() : '';
      if (!areaName) {
        return false;
      }

      const key = areaName.toLowerCase();
      const areaStats = areaStatsMap?.[key];
      if (!areaStats) {
        return false;
      }

      if (markerMode === MARKER_MODES.BOROUGHS) {
        return true;
      }

      if (markerMode === MARKER_MODES.AREAS) {
        if (!areaStats.borough) {
          return false;
        }
        if (focusedBorough) {
          return areaStats.borough === focusedBorough;
        }
        return activeBoroughs.length === 0 || activeBoroughs.includes(areaStats.borough);
      }

      if (markerMode === MARKER_MODES.PUBS) {
        if (focusedBorough && areaStats?.borough !== focusedBorough) {
          return false;
        }
        return nearestAreaKeys.length === 0 || nearestAreaKeys.includes(key);
      }

      return true;
    });

    // Check if any filters are active
    const hasFeaturesFilter = selectedFeatures && selectedFeatures.length > 0;
    const hasOwnershipsFilter = selectedOwnerships && selectedOwnerships.length > 0;
    const hasYearRangeFilter = yearRange && yearRange.min !== null && yearRange.max !== null;
    const hasAreaFilter = selectedArea && selectedArea.trim().length > 0;
    const hasFavoritesFilter = showOnlyFavorites === true;
    const hasAchievementsFilter = showOnlyAchievements === true;
    
    // If no filters selected, return all pubs (possibly limited by borough)
    if (!hasFeaturesFilter && !hasOwnershipsFilter && !hasYearRangeFilter && !hasAreaFilter && !hasFavoritesFilter && !hasAchievementsFilter) {
      return basePubs;
    }

    // Single-pass filter with early returns for better performance
    return basePubs.filter(pub => {
      // Check features filter (ALL must match - AND logic)
      if (hasFeaturesFilter) {
        if (!pub.features || !Array.isArray(pub.features)) {
          return false;
        }
        if (!selectedFeatures.every(selectedFeature => pub.features.includes(selectedFeature))) {
          return false;
        }
      }

      // Check ownerships filter (ANY must match - OR logic, since a pub can only have one ownership)
      if (hasOwnershipsFilter) {
        if (!pub.ownership || !selectedOwnerships.includes(pub.ownership)) {
          return false;
        }
      }

      // Check year range filter
      if (hasYearRangeFilter) {
        if (!pub.founded) {
          return false;
        }
        const foundedYear = parseInt(pub.founded, 10);
        if (isNaN(foundedYear) || foundedYear < yearRange.min || foundedYear > yearRange.max) {
          return false;
        }
      }

      // Check area filter
      if (hasAreaFilter) {
        if (!pub.area || pub.area.trim().toLowerCase() !== selectedArea.trim().toLowerCase()) {
          return false;
        }
      }

      // Check favorites filter
      if (hasFavoritesFilter && pub.isFavorite !== true) {
        return false;
      }

      // Check achievements filter
      if (hasAchievementsFilter && (!pub.achievements || pub.achievements.length === 0)) {
        return false;
      }

      // Pub matches all active filters
      return true;
    });
  }, [
    allPubs,
    markerMode,
    selectedFeatures,
    selectedOwnerships,
    yearRange,
    selectedArea,
    showOnlyFavorites,
    showOnlyAchievements,
    areaStatsMap,
    activeBoroughs,
    nearestAreaKeys,
    focusedBorough,
  ]);

  const handleFilterApply = useCallback((filters) => {
    const features = filters.features || [];
    const ownerships = filters.ownerships || [];
    const yearRangeFilter = filters.yearRange || null;
    const favoritesFilter = filters.showOnlyFavorites || false;
    const achievementsFilter = filters.showOnlyAchievements || false;
    
    setSelectedFeatures(features);
    setSelectedOwnerships(ownerships);
    setYearRange(yearRangeFilter);
    setShowOnlyFavorites(favoritesFilter);
    setShowOnlyAchievements(achievementsFilter);
    
    // Filters will be applied automatically via filteredPubs useMemo
  }, []);

  // filteredPubs is automatically recalculated via useMemo when dependencies change

  const handleFilterPress = useCallback(() => {
    setShowFilterScreen(true);
  }, []);

  const handleFilterClose = useCallback(() => {
    setShowFilterScreen(false);
  }, []);

  const closeCard = useCallback(() => {
    setSelectedPub(null);
  }, []);
  
  const imageMap = {
    'assets/PubPhotos/Abbey_Arms.jpeg': require('../assets/PubPhotos/Abbey_Arms.jpeg'),
    'assets/PubPhotos/Birchwood.jpeg': require('../assets/PubPhotos/Birchwood.jpeg'),
    'assets/PubPhotos/George_&_Dragon.jpeg': require('../assets/PubPhotos/George_&_Dragon.jpg'),
    'assets/PubPhotos/George_&_Dragon.jpg': require('../assets/PubPhotos/George_&_Dragon.jpg'),
    'assets/PubPhotos/Red_Lion_&_Pineapple.jpeg': require('../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
    'assets/PubPhotos/Red_Lion_&_Pineapple.jpg': require('../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
  };
  
  const placeholderImage = require('../assets/PubPhotos/Placeholder.jpg');
  
  const getImageSource = useCallback((photoUrl) => {
    if (!photoUrl) return placeholderImage;
    
    // Handle local assets (assets/...)
    if (photoUrl.startsWith('assets/')) {
      if (imageMap[photoUrl]) return imageMap[photoUrl];
      const jpgUrl = photoUrl.replace('.jpeg', '.jpg');
      if (imageMap[jpgUrl]) return imageMap[jpgUrl];
      const jpegUrl = photoUrl.replace('.jpg', '.jpeg');
      if (imageMap[jpegUrl]) return imageMap[jpegUrl];
      return placeholderImage;
    }
    
    // Handle remote URLs (http:// or https://)
    if (photoUrl.startsWith('http://') || photoUrl.startsWith('https://')) {
      return { uri: photoUrl };
    }
    
    // Fallback to placeholder for unknown formats
    return placeholderImage;
  }, []);


  const regionsAreApproximatelyEqual = useCallback((regionA, regionB) => {
    if (!regionA || !regionB) return false;
    const latDiff = Math.abs(regionA.latitude - regionB.latitude);
    const lonDiff = Math.abs(regionA.longitude - regionB.longitude);
    const latDeltaDiff = Math.abs((regionA.latitudeDelta || 0) - (regionB.latitudeDelta || 0));
    const lonDeltaDiff = Math.abs((regionA.longitudeDelta || 0) - (regionB.longitudeDelta || 0));

    return (
      latDiff < REGION_LATITUDE_EPSILON &&
      lonDiff < REGION_LONGITUDE_EPSILON &&
      latDeltaDiff < REGION_LATITUDE_EPSILON &&
      lonDeltaDiff < REGION_LONGITUDE_EPSILON
    );
  }, []);

  const mergePubs = useCallback((incomingPubs) => {
    if (!Array.isArray(incomingPubs) || incomingPubs.length === 0) {
      return;
    }

    setAllPubs((currentPubs) => {
      if (!Array.isArray(currentPubs) || currentPubs.length === 0) {
        return incomingPubs;
      }

      const pubMap = new Map(currentPubs.map((pub) => [pub.id, pub]));
      let didChange = false;

      incomingPubs.forEach((pub) => {
        if (!pub || !pub.id) {
          return;
        }
        const existing = pubMap.get(pub.id);
        if (!existing) {
          pubMap.set(pub.id, pub);
          didChange = true;
          return;
        }

        const hasDifferences = Object.keys(pub).some((key) => existing[key] !== pub[key]);
        if (hasDifferences) {
          pubMap.set(pub.id, { ...existing, ...pub });
          didChange = true;
        }
      });

      if (!didChange) {
        return currentPubs;
      }

      return Array.from(pubMap.values());
    });
  }, []);

  // NOTE: We no longer update profile stats from allPubs state because:
  // 1. allPubs only contains viewport pubs (for performance reasons)
  // 2. The correct total count comes from loadAllPubsInBackground which fetches ALL pubs
  // 3. Calling primeProfileStatsFromPubs with viewport pubs would overwrite the correct total
  // Profile stats are updated by loadAllPubsInBackground which runs on mount and fetches all pubs

  // Interpolate color from grey to amber based on completion percentage (0-100)
  const boroughMarkerCacheRef = useRef({ key: null, elements: [] });
  const areaMarkerCacheRef = useRef({ key: null, elements: [] });

  const areaMarkerElements = useMemo(() => {
    if (markerMode === MARKER_MODES.BOROUGHS) {
      return [];
    }

    const entries = Object.entries(areaStatsMap || {})
      .map(([key, stats]) => {
        const completion =
          typeof stats?.completionPercentage === 'number'
            ? stats.completionPercentage
            : stats?.totalPubs
              ? (stats.visitedPubs / stats.totalPubs) * 100
              : 0;
        return {
          areaKey: key,
          stats,
          completion,
        };
      })
      .filter(({ stats }) => {
        if (!stats?.center) {
          return false;
        }
        if (!stats.totalPubs) {
          return false;
        }
        if (markerMode === MARKER_MODES.AREAS) {
          if (!stats.borough) {
            return false;
          }
          if (focusedBorough) {
            return stats.borough === focusedBorough;
          }
          return activeBoroughs.length === 0 || activeBoroughs.includes(stats.borough);
        }
        return true;
      })
      .sort((a, b) => (a.stats.name || '').localeCompare(b.stats.name || ''));

    const cacheKey = JSON.stringify(
      entries.map(({ areaKey, stats, completion }) => [
        areaKey,
        Number(stats.center.latitude.toFixed(5)),
        Number(stats.center.longitude.toFixed(5)),
        Number(completion.toFixed(4)),
      ])
    );

    if (areaMarkerCacheRef.current.key === cacheKey) {
      return areaMarkerCacheRef.current.elements;
    }

    const newElements = entries.map(({ areaKey, stats, completion }) => {
      const areaColor = interpolateColor(completion);

      return (
        <Marker
          key={`area-${areaKey}`}
          coordinate={stats.center}
          onPress={() => handleAreaMarkerPress(stats.name)}
        >
          <View style={styles.markerContainer}>
            <AreaIcon size={36} color={areaColor} />
          </View>
        </Marker>
      );
    });

    areaMarkerCacheRef.current = { key: cacheKey, elements: newElements };
    return newElements;
  }, [markerMode, areaStatsMap, handleAreaMarkerPress, activeBoroughs, focusedBorough, interpolateColor]);

  const pubMarkerElements = useMemo(() => {
    return filteredPubs
      .filter((p) => typeof p.lat === 'number' && typeof p.lon === 'number')
      .map((p) => (
        <PubMarker
          key={p.id}
          pub={p}
          onPress={handlePubPress}
        />
      ));
  }, [filteredPubs, handlePubPress]);

  const updateMarkerMode = useCallback((region) => {
    if (!region) return;

    const latitudeDelta =
      typeof region.latitudeDelta === 'number' ? region.latitudeDelta : BOROUGH_ENTER_DELTA;
    const longitudeDelta = typeof region.longitudeDelta === 'number' ? region.longitudeDelta : latitudeDelta;
    const maxDelta = Math.max(latitudeDelta, longitudeDelta);

    setMarkerMode((currentMode) => {
      if (currentMode === MARKER_MODES.BOROUGHS) {
        if (maxDelta < BOROUGH_EXIT_DELTA) {
          return MARKER_MODES.AREAS;
        }
        return currentMode;
      }
      if (currentMode === MARKER_MODES.AREAS) {
        if (maxDelta > BOROUGH_ENTER_DELTA) {
          return MARKER_MODES.BOROUGHS;
        }
        if (maxDelta < AREA_EXIT_DELTA) {
          return MARKER_MODES.PUBS;
        }
        return currentMode;
      }
      if (currentMode === MARKER_MODES.PUBS && maxDelta > AREA_ENTER_DELTA) {
        return MARKER_MODES.AREAS;
      }
      return currentMode;
    });
  }, []);

  const commitMapRegion = useCallback((region) => {
    if (!region) return;
    lastCommittedRegionRef.current = region;
    setMapRegion(region);
    updateMarkerMode(region);
  }, [updateMarkerMode]);

  const handleBoroughMarkerPress = useCallback((summary) => {
    if (!summary || !summary.center) return;

    const bounds = summary.bounds;
    const latSpan = bounds
      ? Math.max((bounds.north - bounds.south) * 1.6, BOROUGH_EXIT_DELTA)
      : BOROUGH_EXIT_DELTA;
    const lonSpan = bounds
      ? Math.max((bounds.east - bounds.west) * 1.6, BOROUGH_EXIT_DELTA)
      : BOROUGH_EXIT_DELTA;

    const newRegion = {
      latitude: summary.center.latitude,
      longitude: summary.center.longitude,
      latitudeDelta: latSpan,
      longitudeDelta: lonSpan,
    };

    setSelectedPub(null);
    isNavigatingRef.current = true;
    commitMapRegion(newRegion);
    if (mapRef.current) {
      mapRef.current.animateToRegion(newRegion, 1000);
      setTimeout(() => {
        isNavigatingRef.current = false;
        // Load pubs for the new region
        if (loadPubsForViewportRegion) {
          loadPubsForViewportRegion(newRegion);
        }
      }, 1050);
    } else {
      isNavigatingRef.current = false;
      // Load pubs for the new region
      if (loadPubsForViewportRegion) {
        loadPubsForViewportRegion(newRegion);
      }
    }
  }, [commitMapRegion, loadPubsForViewportRegion]);

  const boroughMarkerElements = useMemo(() => {
    if (!Array.isArray(boroughSummaries) || boroughSummaries.length === 0) {
      return [];
    }

    const entries = boroughSummaries
      .filter((summary) => summary && summary.center)
      .map((summary) => {
        const completion =
          typeof summary.completionPercentage === 'number'
            ? summary.completionPercentage
            : summary.totalPubs > 0
              ? (summary.visitedPubs / summary.totalPubs) * 100
              : 0;
        return {
          summary,
          completion,
        };
      })
      .filter(
        ({ summary }) =>
          Number.isFinite(summary.center?.latitude) && Number.isFinite(summary.center?.longitude)
      )
      .sort((a, b) => a.summary.borough.localeCompare(b.summary.borough));

    const cacheKey = JSON.stringify(
      entries.map(({ summary, completion }) => [
        summary.borough,
        Number.isFinite(summary.center?.latitude)
          ? Number(summary.center.latitude.toFixed(4))
          : null,
        Number.isFinite(summary.center?.longitude)
          ? Number(summary.center.longitude.toFixed(4))
          : null,
        Number.isFinite(completion) ? Number(completion.toFixed(4)) : 0,
      ])
    );

    if (boroughMarkerCacheRef.current.key === cacheKey) {
      return boroughMarkerCacheRef.current.elements;
    }

    // Logic retained but markers not rendered - return empty array
    const newElements = [];

    boroughMarkerCacheRef.current = { key: cacheKey, elements: newElements };
    return newElements;
  }, [boroughSummaries, handleBoroughMarkerPress, shouldTrackBoroughViews]);

  // Handle area marker press on map - zoom in to show individual pubs in that area
  const handleAreaMarkerPress = useCallback(async (areaName) => {
    const areaStats = calculateAreaStats(areaName, filteredPubs);
    if (areaStats.pubs.length === 0) return;
    
    const center = getAreaCenter(areaStats.pubs);
    if (!center) return;
    
    // Calculate bounds for the area
    const lats = areaStats.pubs.map(pub => parseFloat(pub.lat));
    const lons = areaStats.pubs.map(pub => parseFloat(pub.lon));
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    
    const latDelta = Math.max((maxLat - minLat) * 2.5, 0.01);
    const lonDelta = Math.max((maxLon - minLon) * 2.5, 0.01);
    
        isNavigatingRef.current = true;
    
    const newRegion = {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: Math.max(Math.min(latDelta, AREA_EXIT_DELTA - 0.005), 0.01),
      longitudeDelta: Math.max(Math.min(lonDelta, AREA_EXIT_DELTA - 0.005), 0.01),
    };
    
    commitMapRegion(newRegion);
    if (mapRef.current) {
      mapRef.current.animateToRegion(newRegion, 1000);
      
      setTimeout(() => {
        isNavigatingRef.current = false;
        // Load pubs for the new region
        if (loadPubsForViewportRegion) {
          loadPubsForViewportRegion(newRegion);
        }
      }, 1050);
    } else {
      isNavigatingRef.current = false;
      // Load pubs for the new region
      if (loadPubsForViewportRegion) {
        loadPubsForViewportRegion(newRegion);
      }
    }
    
    // Don't set selectedPub - just zoom in
    setSelectedPub(null);
  }, [filteredPubs, commitMapRegion, loadPubsForViewportRegion]);

  // Pre-sort pubs alphabetically once when allPubs changes - memoized for performance
  const sortedPubs = useMemo(() => {
    return [...allPubs].sort((a, b) => {
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [allPubs]);

  // Filter areas based on search query - memoized for performance
  const areaSuggestions = useMemo(() => {
    if (!searchQuery.trim()) {
      // Return first 3 alphabetical areas when no query
      return allAreas.slice(0, 3);
    }
    const query = searchQuery.trim().toLowerCase();
    return allAreas.filter(area => 
      area.toLowerCase().includes(query)
    ).slice(0, 3); // Limit to 3 suggestions
  }, [searchQuery, allAreas]);

  // Filter pub names based on search query - memoized for performance
  const pubSuggestions = useMemo(() => {
    if (!searchQuery.trim()) {
      // Return first 3 alphabetical pub names when no query
      return sortedPubs.slice(0, 3);
    }
    const query = searchQuery.trim().toLowerCase();
    return allPubs.filter(pub => 
      pub.name?.toLowerCase().includes(query)
    ).slice(0, 3); // Limit to 3 suggestions
  }, [searchQuery, allPubs, sortedPubs]);

  const handleSearchFocus = useCallback(() => {
    setShowSuggestions(true);
  }, []);

  const handleSearchBlur = useCallback(() => {
    // Delay hiding to allow suggestion tap to register
    setTimeout(() => {
      setShowSuggestions(false);
    }, 200);
  }, []);

  const searchBorough = useCallback(async (boroughName) => {
    if (!boroughName || typeof boroughName !== 'string') {
      return false;
    }

    const trimmedName = boroughName.trim();
    if (trimmedName.length === 0) {
      return false;
    }

    const normalizedLower = trimmedName.toLowerCase();
    let summary =
      Array.isArray(boroughSummaries) && boroughSummaries.length > 0
        ? boroughSummaries.find(
            (item) =>
              typeof item?.borough === 'string' &&
              item.borough.toLowerCase() === normalizedLower
          )
        : null;

    let center = summary?.center;
    let bounds = summary?.bounds;

    const hasValidCenter =
      center &&
      Number.isFinite(center.latitude) &&
      Number.isFinite(center.longitude);

    if (
      !hasValidCenter &&
      Array.isArray(allPubs) &&
      allPubs.length > 0
    ) {
      const boroughPubs = allPubs.filter(
        (pub) =>
          typeof pub?.borough === 'string' &&
          pub.borough.trim().toLowerCase() === normalizedLower
      );

      if (boroughPubs.length > 0) {
        const validCoords = boroughPubs
          .map((pub) => ({
            lat: Number.parseFloat(pub.lat),
            lon: Number.parseFloat(pub.lon),
          }))
          .filter(
            (coords) =>
              Number.isFinite(coords.lat) && Number.isFinite(coords.lon)
          );

        if (validCoords.length > 0) {
          const sumLat = validCoords.reduce((sum, coords) => sum + coords.lat, 0);
          const sumLon = validCoords.reduce((sum, coords) => sum + coords.lon, 0);
          const lats = validCoords.map((coords) => coords.lat);
          const lons = validCoords.map((coords) => coords.lon);

          center = {
            latitude: sumLat / validCoords.length,
            longitude: sumLon / validCoords.length,
          };
          bounds = {
            north: Math.max(...lats),
            south: Math.min(...lats),
            east: Math.max(...lons),
            west: Math.min(...lons),
          };
        }
      }
    }

    if (
      !center ||
      !Number.isFinite(center.latitude) ||
      !Number.isFinite(center.longitude)
    ) {
      return false;
    }

    const boundsLatSpan =
      bounds &&
      Number.isFinite(bounds.north) &&
      Number.isFinite(bounds.south)
        ? Math.abs(bounds.north - bounds.south)
        : null;
    const boundsLonSpan =
      bounds &&
      Number.isFinite(bounds.east) &&
      Number.isFinite(bounds.west)
        ? Math.abs(bounds.east - bounds.west)
        : null;

    const maxDeltaForAreas = Math.max(BOROUGH_EXIT_DELTA - 0.01, AREA_ENTER_DELTA);

    const targetLatDelta = boundsLatSpan
      ? Math.max(boundsLatSpan * 1.2, AREA_ENTER_DELTA)
      : Math.max(BOROUGH_EXIT_DELTA * 0.6, AREA_ENTER_DELTA);
    const targetLonDelta = boundsLonSpan
      ? Math.max(boundsLonSpan * 1.2, AREA_ENTER_DELTA)
      : Math.max(BOROUGH_EXIT_DELTA * 0.6, AREA_ENTER_DELTA);

    const newRegion = {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: Math.min(targetLatDelta, maxDeltaForAreas),
      longitudeDelta: Math.min(targetLonDelta, maxDeltaForAreas),
    };

    setSelectedArea(null);
    setFocusedBorough(trimmedName);
    setSelectedPub(null);

    isNavigatingRef.current = true;
    commitMapRegion(newRegion);
    if (mapRef.current) {
      mapRef.current.animateToRegion(newRegion, 1000);
      setTimeout(() => {
        isNavigatingRef.current = false;
        // Load pubs for the new region
        if (loadPubsForViewportRegion) {
          loadPubsForViewportRegion(newRegion);
        }
      }, 1050);
    } else {
      isNavigatingRef.current = false;
      // Load pubs for the new region
      if (loadPubsForViewportRegion) {
        loadPubsForViewportRegion(newRegion);
      }
    }

    return true;
  }, [boroughSummaries, allPubs, commitMapRegion, loadPubsForViewportRegion]);

  // Shared function to search for an area using pub coordinates
  // If applyAreaFilter is true, also filter pubs to only show pubs in that area
  const searchArea = useCallback(async (areaName, applyAreaFilter = false) => {
    setFocusedBorough(null);
    // Calculate center point from actual pubs in this area instead of geocoding
    // This ensures we zoom to the correct location based on actual pub data
    // and avoids issues with duplicate place names (e.g., multiple "Ashford" locations)
    const pubsInArea = allPubs.filter(pub => 
      pub.area && pub.area.trim().toLowerCase() === areaName.toLowerCase()
    );
    
    if (pubsInArea.length > 0) {
      // Calculate the center point of all pubs in this area
      const validPubs = pubsInArea.filter(pub => pub.lat && pub.lon);
      
      if (validPubs.length > 0) {
        const sumLat = validPubs.reduce((sum, pub) => sum + parseFloat(pub.lat), 0);
        const sumLon = validPubs.reduce((sum, pub) => sum + parseFloat(pub.lon), 0);
        const centerLat = sumLat / validPubs.length;
        const centerLon = sumLon / validPubs.length;
        
        // Calculate bounds to determine appropriate zoom level
        const lats = validPubs.map(pub => parseFloat(pub.lat));
        const lons = validPubs.map(pub => parseFloat(pub.lon));
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);
        
        // Calculate appropriate deltas to show all pubs in the area
        const latDelta = Math.max((maxLat - minLat) * 2.5, 0.01); // At least 0.01, but scale if pubs spread out
        const lonDelta = Math.max((maxLon - minLon) * 2.5, 0.01);
        
        isNavigatingRef.current = true;
        
        const newRegion = {
          latitude: centerLat,
          longitude: centerLon,
          latitudeDelta: Math.min(latDelta, 0.05), // Cap at reasonable zoom level
          longitudeDelta: Math.min(lonDelta, 0.05),
        };
        
        commitMapRegion(newRegion);
        if (mapRef.current) {
          mapRef.current.animateToRegion(newRegion, 1000);
          
          // Reset navigation flag after animation completes
          setTimeout(() => {
            isNavigatingRef.current = false;
            // Load pubs for the new region
            if (loadPubsForViewportRegion) {
              loadPubsForViewportRegion(newRegion);
            }
          }, 1050);
        } else {
          isNavigatingRef.current = false;
          // Load pubs for the new region
          if (loadPubsForViewportRegion) {
            loadPubsForViewportRegion(newRegion);
          }
        }
        
        // Explicitly don't set selectedPub - no pub card should appear
        setSelectedPub(null);
        
        // Apply area filter if requested
        if (applyAreaFilter) {
          setSelectedArea(areaName);
        }
        
        return true; // Success
      }
    }
    
    // Fallback to geocoding if no pubs found in area (shouldn't happen, but safety net)
    // Search the whole UK, not just London
    try {
      const encodedQuery = encodeURIComponent(`${areaName}, UK`);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=1`,
        {
          headers: {
            'User-Agent': 'PubTrackerApp/1.0'
          }
        }
      );
      
      const data = await response.json();
      
      if (data && data.length > 0) {
        isNavigatingRef.current = true;
        
        const location = data[0];
        const newRegion = {
          latitude: parseFloat(location.lat),
          longitude: parseFloat(location.lon),
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        };
        
        commitMapRegion(newRegion);
        if (mapRef.current) {
          mapRef.current.animateToRegion(newRegion, 1000);
          
          setTimeout(() => {
            isNavigatingRef.current = false;
            // Load pubs for the new region
            if (loadPubsForViewportRegion) {
              loadPubsForViewportRegion(newRegion);
            }
          }, 1050);
        } else {
          isNavigatingRef.current = false;
          // Load pubs for the new region
          if (loadPubsForViewportRegion) {
            loadPubsForViewportRegion(newRegion);
          }
        }
        
        // Explicitly don't set selectedPub - no pub card should appear
        setSelectedPub(null);
        return true; // Success
      }
    } catch (error) {
      console.error('Area search error:', error);
      isNavigatingRef.current = false;
    }
    
    return false; // Failed
  }, [allPubs, commitMapRegion, loadPubsForViewportRegion]);

  // Shared function to search for a pub
  const searchPub = useCallback((pub) => {
    isNavigatingRef.current = true;
    
    // Ensure we have valid coordinates
    if (pub.lat && pub.lon) {
      // Zoom to the pub and show the pub card
      const newRegion = {
        latitude: parseFloat(pub.lat),
        longitude: parseFloat(pub.lon),
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      
      // Update region state first
      commitMapRegion(newRegion);
      
      // Then animate the map
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
        
        // Reset navigation flag after animation completes
        setTimeout(() => {
          isNavigatingRef.current = false;
          // Load pubs for the new region
          if (loadPubsForViewportRegion) {
            loadPubsForViewportRegion(newRegion);
          }
        }, 1050);
      } else {
        isNavigatingRef.current = false;
        // Load pubs for the new region
        if (loadPubsForViewportRegion) {
          loadPubsForViewportRegion(newRegion);
        }
      }
      
      // Set the selected pub
      setSelectedPub(pub);
      return true; // Success
    } else {
      console.error('Pub missing coordinates:', pub);
      isNavigatingRef.current = false;
      return false; // Failed
    }
  }, [commitMapRegion, loadPubsForViewportRegion]);

  const handleSearch = useCallback(async (queryOverride = null) => {
    const queryToUse = queryOverride !== null ? queryOverride : searchQuery;
    if (!queryToUse.trim()) return;

    setShowSuggestions(false);
    Keyboard.dismiss();
    const query = queryToUse.trim().toLowerCase();
    
    // Check for direct borough match first
    const matchingBorough = allBoroughNames.find(borough =>
      borough.toLowerCase() === query || borough.toLowerCase().includes(query)
    );

    if (matchingBorough) {
      await searchBorough(matchingBorough);
      return;
    }

    // Next check if query matches an area - if so, zoom to area (no card)
    const matchingArea = allAreas.find(area => 
      area.toLowerCase().includes(query)
    );

    if (matchingArea) {
      // Use shared searchArea function
      await searchArea(matchingArea);
      return;
    }

    // If no area match, check if query exactly matches a pub name - if so, zoom to pub and show card
    // Search in allPubs (not filtered pubs) so we can find any pub regardless of filters
    // Only match exact pub names to avoid conflicts with area names
    const matchingPubByName = allPubs.find(pub => 
      pub.name?.toLowerCase().trim() === query
    );

    if (matchingPubByName) {
      // Use shared searchPub function
      searchPub(matchingPubByName);
      return;
    }

    // If neither pub name nor area match, do general geocoding search
    // Search the whole UK, not just London
    try {
      const encodedQuery = encodeURIComponent(`${queryToUse}, UK`);
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=1`,
        {
          headers: {
            'User-Agent': 'PubTrackerApp/1.0'
          }
        }
      );
      
      const data = await response.json();
      
      if (data && data.length > 0) {
        // Clear any region locks to allow search navigation
        
        const location = data[0];
        const newRegion = {
          latitude: parseFloat(location.lat),
          longitude: parseFloat(location.lon),
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        };
        commitMapRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 1000);
        // Don't set selectedPub for general searches - no pub card
        setSelectedPub(null);
        // Load pubs for the new region
        setTimeout(() => {
          if (loadPubsForViewportRegion) {
            loadPubsForViewportRegion(newRegion);
          }
        }, 1100);
      }
    } catch (error) {
      console.error('Search error:', error);
    }
  }, [searchQuery, allAreas, allPubs, allBoroughNames, searchArea, searchPub, searchBorough, loadPubsForViewportRegion]);

  const clearSearch = useCallback(() => {
    setSearchQuery('');
    setSelectedArea(null); // Clear area filter when clearing search
    setFocusedBorough(null);
    // Don't center on London - keep map at current position
    setShowSuggestions(false);
    
    // Track which area was cleared to prevent re-applying it if route params come back
    const currentArea = route.params?.areaToSearch || processedAreaRef.current;
    if (currentArea) {
      clearedAreaRef.current = currentArea;
    }
    const currentBorough = route.params?.boroughToSearch || processedBoroughRef.current;
    if (currentBorough) {
      clearedBoroughRef.current = currentBorough;
    }
    
    // Clear route params permanently so they don't come back when navigating away and back
    // Merge existing params and remove areaToSearch key to fully clear it
    const currentParams = route.params || {};
    const { areaToSearch, boroughToSearch, ...remainingParams } = currentParams;
    navigation.setParams(remainingParams);
    
    // Reset processed area ref
    processedAreaRef.current = null;
    processedBoroughRef.current = null;
  }, [route.params, navigation]);

  const handleAreaPress = useCallback(async (area) => {
    setSearchQuery(area);
    setShowSuggestions(false);
    Keyboard.dismiss();
    
    // Use shared searchArea function
    await searchArea(area);
  }, [searchArea]);

  // Handle route params when navigating from ProfileScreen with an area to search
  const processedAreaRef = useRef(null);
  const processedBoroughRef = useRef(null);
  useFocusEffect(
    useCallback(() => {
      const areaToSearch = route.params?.areaToSearch;
      const boroughToSearch = route.params?.boroughToSearch;
      
      // Only process area search if:
      // 1. We have a valid area to search (non-empty string)
      // 2. It's different from what we've already processed
      // 3. Pubs are loaded
      // 4. It was NOT explicitly cleared by the user (don't re-apply cleared areas)
      if (areaToSearch && 
          typeof areaToSearch === 'string' && 
          areaToSearch.trim().length > 0 &&
          areaToSearch !== processedAreaRef.current && 
          allPubs.length > 0 &&
          areaToSearch !== clearedAreaRef.current) {
        // This is a new area search from ProfileScreen - process it
        processedAreaRef.current = areaToSearch;
        clearedAreaRef.current = null; // Reset cleared area since this is a new search
        // Search the area and apply filter
        searchArea(areaToSearch, true);
        setSearchQuery(areaToSearch);
      } else if (!areaToSearch) {
        // Route params were cleared/removed - reset processed ref
        processedAreaRef.current = null;
      }
      
      if (
        boroughToSearch &&
        typeof boroughToSearch === 'string' &&
        boroughToSearch.trim().length > 0 &&
        boroughToSearch !== processedBoroughRef.current &&
        allPubs.length > 0 &&
        boroughToSearch !== clearedBoroughRef.current
      ) {
        processedBoroughRef.current = boroughToSearch;
        clearedBoroughRef.current = null;
        searchBorough(boroughToSearch);
        setSearchQuery(boroughToSearch);
      } else if (!boroughToSearch) {
        processedBoroughRef.current = null;
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      route.params?.areaToSearch,
      route.params?.boroughToSearch,
      allPubs.length,
      searchArea,
      searchBorough,
    ])
  );

  const handlePubSuggestionPress = useCallback(async (pub) => {
    setSearchQuery(pub.name);
    setShowSuggestions(false);
    Keyboard.dismiss();
    
    // Use shared searchPub function
    searchPub(pub);
  }, [searchPub]);

  const handleCurrentLocation = useCallback(async () => {
    // Use cached location immediately for instant response
    if (currentLocation) {
      isNavigatingRef.current = true;
      
      const newRegion = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      
      // Update region state
        commitMapRegion(newRegion);
      
      // Animate immediately - no waiting for location fetch
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
      }
      
      // Clear navigation flag after animation completes
      setTimeout(() => {
        isNavigatingRef.current = false;
        // Load pubs for the new region
        if (loadPubsForViewportRegion) {
          loadPubsForViewportRegion(newRegion);
        }
      }, 1050);
      return;
    }
    
    // Fallback: Only fetch if we don't have cached location (should rarely happen)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

      isNavigatingRef.current = true;
      
      // Update region state
      commitMapRegion(newRegion);

      const latestLocation = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      lastLocationRef.current = latestLocation;
      lastLocationUpdateRef.current = Date.now();
      setCurrentLocation(latestLocation);

      const headingValue = location.coords.heading;
      if (
        typeof headingValue === 'number' &&
        !Number.isNaN(headingValue) &&
        ((lastHeadingRef.current === null || lastHeadingRef.current === undefined) ||
          Math.abs(headingValue - lastHeadingRef.current) >= LOCATION_HEADING_EPSILON_DEGREES)
      ) {
        lastHeadingRef.current = headingValue;
        setHeading(headingValue);
      }
      
      // Animate quickly - reduced duration for faster response 
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
      }
      
      // Clear navigation flag after animation completes
      setTimeout(() => {
        isNavigatingRef.current = false;
        // Load pubs for the new region
        if (loadPubsForViewportRegion) {
          loadPubsForViewportRegion(newRegion);
        }
      }, 1050);
    } catch (error) {
      console.error('Error getting location:', error);
      isNavigatingRef.current = false;
    }
  }, [currentLocation, commitMapRegion, loadPubsForViewportRegion]);

  const openMissingPubModal = useCallback(() => {
    setMissingPubError(null);
    setIsMissingPubModalVisible(true);
  }, []);

  const closeMissingPubModal = useCallback(() => {
    if (isSubmittingMissingPub) {
      return;
    }
    setIsMissingPubModalVisible(false);
    setMissingPubError(null);
  }, [isSubmittingMissingPub]);

  const handleSubmitMissingPub = useCallback(
    async ({ pubName, pubLocation }) => {
      setIsSubmittingMissingPub(true);
      setMissingPubError(null);
      try {
        await submitMissingPubReport(pubName, pubLocation);
        setIsMissingPubModalVisible(false);
        setIsMissingPubSuccessVisible(true);
      } catch (error) {
        const message =
          error?.message ||
          'Unable to submit report right now. Please try again in a moment.';
        setMissingPubError(message);
      } finally {
        setIsSubmittingMissingPub(false);
      }
    },
    []
  );

  return (
    <View style={styles.container}>
      <SearchBar 
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onSearch={handleSearch}
        onClear={clearSearch}
        onFilterPress={handleFilterPress}
        onFocus={handleSearchFocus}
        onBlur={handleSearchBlur}
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
          // Ignore region changes during programmatic navigation
          if (isNavigatingRef.current) {
            return;
          }
          
          // Throttle region updates to reduce state updates during panning/zooming
          // Clear any pending timeout
          if (regionChangeTimeoutRef.current) {
            clearTimeout(regionChangeTimeoutRef.current);
          }
          
          // Update region state after a short delay (debounce)
          // This reduces state updates during active panning/zooming
          regionChangeTimeoutRef.current = setTimeout(() => {
            const lastRegion = lastCommittedRegionRef.current;
            if (regionsAreApproximatelyEqual(lastRegion, region)) {
              regionChangeTimeoutRef.current = null;
              return;
            }
            commitMapRegion(region);
            regionChangeTimeoutRef.current = null;
          }, 150); // 150ms debounce - balances responsiveness with performance
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
        mapPadding={{
          // Keep padding constant to prevent map jumping
          // The card overlays the map, so padding doesn't need to change
          bottom: 0,
        }}
      >
        {currentLocation && (
          <Marker
            coordinate={currentLocation}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
          >
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

      <TouchableOpacity 
        style={[
          styles.missingPubButton,
          {
            bottom: floatingButtonBottom,
          },
        ]}
        onPress={openMissingPubModal}
      >
        <MaterialCommunityIcons name="flag-plus-outline" size={24} color={AMBER} />
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.locationButton, { 
          bottom: floatingButtonBottom,
        }]}
        onPress={handleCurrentLocation}
      >
        <MaterialCommunityIcons name="crosshairs-gps" size={24} color={AMBER} />
      </TouchableOpacity>
      
      <DraggablePubCard 
        pub={selectedPub}
        onClose={closeCard}
        onToggleVisited={handleToggleVisited}
        onToggleFavorite={handleToggleFavorite}
        getImageSource={getImageSource}
      />
      <ReportMissingPubModal
        visible={isMissingPubModalVisible}
        onClose={closeMissingPubModal}
        onSubmit={handleSubmitMissingPub}
        isSubmitting={isSubmittingMissingPub}
        errorMessage={missingPubError}
      />
      {isMissingPubSuccessVisible && (
        <View
          style={[
            styles.feedbackToast,
            {
              bottom: floatingButtonBottom + 68,
            },
          ]}
        >
          <MaterialCommunityIcons name="check-circle" size={20} color={AMBER} />
          <Text style={styles.feedbackToastText}>Missing pub successfully reported</Text>
          <TouchableOpacity
            onPress={() => setIsMissingPubSuccessVisible(false)}
            style={styles.feedbackToastCloseButton}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialCommunityIcons name="close" size={20} color={DARK_CHARCOAL} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  locationButton: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: DARK_CHARCOAL,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  missingPubButton: {
    position: 'absolute',
    left: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: DARK_CHARCOAL,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  feedbackToast: {
    position: 'absolute',
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  feedbackToastText: {
    color: DARK_CHARCOAL,
    fontWeight: '600',
    fontSize: 15,
    flex: 1,
    marginLeft: 12,
    marginRight: 12,
  },
  feedbackToastCloseButton: {
    padding: 4,
  },
  boroughCallout: {
    backgroundColor: 'rgba(28, 28, 28, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    maxWidth: 160,
  },
  boroughCalloutText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  markerContainer: {
    backgroundColor: 'transparent',
  },
  userLocationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  userLocationDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#4285F4',
    borderWidth: 3,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  userLocationArrow: {
    position: 'absolute',
    top: -8,
    alignItems: 'center',
    justifyContent: 'center',
  },
});