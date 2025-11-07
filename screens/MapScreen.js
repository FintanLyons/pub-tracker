import React, { useEffect, useState, useRef, useCallback, useContext } from 'react';
import { 
  View, 
  Dimensions, 
  TouchableOpacity, 
  StyleSheet,
  Keyboard
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useFocusEffect, useNavigation } from '@react-navigation/native';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchLondonPubs, togglePubVisited } from '../services/PubService';
import PintGlassIcon from '../components/PintGlassIcon';
import AreaIcon from '../components/AreaIcon';
import SearchBar from '../components/SearchBar';
import SearchSuggestions from '../components/SearchSuggestions';
import DraggablePubCard from '../components/DraggablePubCard';
import FilterScreen from './FilterScreen';
import { LoadingContext } from '../contexts/LoadingContext';

const LONDON = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.1, longitudeDelta: 0.1 };

// Zoom threshold for switching between area markers and individual pub markers
// When latitudeDelta > AREA_ZOOM_THRESHOLD, show area markers; otherwise show individual pubs
// Higher values = individual pubs appear at more zoomed-out levels
const AREA_ZOOM_THRESHOLD = 0.06; // Adjust this value to optimize zoom level switching

const AMBER = '#D4A017';
const MEDIUM_GREY = '#757575';
const DARK_CHARCOAL = '#1C1C1C';

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
        "saturation": -15
      },
      {
        "lightness": 15
      },
      {
        "visibility": "simplified"
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

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { isLocationLoaded, setIsLocationLoaded } = useContext(LoadingContext);
  const [pubs, setPubs] = useState([]);
  const [allPubs, setAllPubs] = useState([]); // Store unfiltered pubs
  const [selectedPub, setSelectedPub] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapRegion, setMapRegion] = useState(LONDON);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [heading, setHeading] = useState(0);
  const [showFilterScreen, setShowFilterScreen] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState([]);
  const [selectedOwnerships, setSelectedOwnerships] = useState([]);
  const [yearRange, setYearRange] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null); // Filter by area name
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState(0);
  const clearedAreaRef = useRef(null); // Track which area was explicitly cleared (to prevent re-applying)
  const mapRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  const isClosingCardRef = useRef(false);
  const lockedRegionRef = useRef(null);
  const isNavigatingRef = useRef(false); // Track when doing programmatic navigation
  const screenHeight = Dimensions.get('window').height;
  const cardHeight = screenHeight * 0.33;

  useEffect(() => {
    fetchLondonPubs().then((fetchedPubs) => {
      setAllPubs(fetchedPubs);
      setPubs(fetchedPubs);
    });
    
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
          
          // Set initial map region to user's location
          const initialRegion = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.1,
            longitudeDelta: 0.1,
          };
          setMapRegion(initialRegion);
          
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
          locationSubscriptionRef.current = await Location.watchPositionAsync(
            {
              accuracy: Location.Accuracy.Balanced,
              timeInterval: 1000,
              distanceInterval: 10,
            },
            (location) => {
              setCurrentLocation({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
              });
              if (location.coords.heading !== null && location.coords.heading !== undefined) {
                setHeading(location.coords.heading);
              }
            }
          );
        } else {
          // Permission denied, use London as fallback
          setIsLocationLoaded(true);
        }
      } catch (error) {
        console.error('Location setup error:', error);
        // On error, use London as fallback
        setIsLocationLoaded(true);
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
    };
  }, []);

  const handlePubPress = (pub) => {
    setSelectedPub(pub);
  };

  const handleToggleVisited = async (pubId) => {
    await togglePubVisited(pubId);
    const updatedPubs = await fetchLondonPubs();
    setAllPubs(updatedPubs);
    applyFilters(updatedPubs, selectedFeatures, selectedOwnerships, yearRange, selectedArea);
    if (selectedPub?.id === pubId) {
      const updatedPub = updatedPubs.find(p => p.id === pubId);
      if (updatedPub) setSelectedPub(updatedPub);
    }
  };

  // Extract all unique features from pubs
  const getAllFeatures = () => {
    const featureSet = new Set();
    allPubs.forEach(pub => {
      if (pub.features && Array.isArray(pub.features)) {
        pub.features.forEach(feature => featureSet.add(feature));
      }
    });
    return Array.from(featureSet).sort();
  };

  // Extract all unique ownerships from pubs
  const getAllOwnerships = () => {
    const ownershipSet = new Set();
    allPubs.forEach(pub => {
      if (pub.ownership && pub.ownership.trim()) {
        ownershipSet.add(pub.ownership);
      }
    });
    return Array.from(ownershipSet).sort();
  };

  // Get min and max founded years from pubs
  const getYearRange = () => {
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
  };

  // Apply filters to pubs (features, ownerships, year range, and area)
  const applyFilters = (pubsToFilter, features, ownerships, yearRangeFilter, areaFilter) => {
    if (!pubsToFilter || pubsToFilter.length === 0) {
      // If no pubs to filter, just show empty or wait for data
      return;
    }
    
    // If no filters selected, show all pubs
    const hasFeaturesFilter = features && features.length > 0;
    const hasOwnershipsFilter = ownerships && ownerships.length > 0;
    const hasYearRangeFilter = yearRangeFilter && yearRangeFilter.min !== null && yearRangeFilter.max !== null;
    const hasAreaFilter = areaFilter && areaFilter.trim().length > 0;
    
    if (!hasFeaturesFilter && !hasOwnershipsFilter && !hasYearRangeFilter && !hasAreaFilter) {
      setPubs([...pubsToFilter]); // Create new array to trigger re-render
      return;
    }

    const filtered = pubsToFilter.filter(pub => {
      // Check features filter (ALL must match - AND logic)
      let matchesFeatures = true;
      if (hasFeaturesFilter) {
        if (!pub.features || !Array.isArray(pub.features)) {
          matchesFeatures = false;
        } else {
          matchesFeatures = features.every(selectedFeature => {
            return pub.features.includes(selectedFeature);
          });
        }
      }

      // Check ownerships filter (ANY must match - OR logic, since a pub can only have one ownership)
      let matchesOwnerships = true;
      if (hasOwnershipsFilter) {
        if (!pub.ownership) {
          matchesOwnerships = false;
        } else {
          matchesOwnerships = ownerships.includes(pub.ownership);
        }
      }

      // Check year range filter
      let matchesYearRange = true;
      if (hasYearRangeFilter) {
        if (!pub.founded) {
          matchesYearRange = false;
        } else {
          const foundedYear = parseInt(pub.founded, 10);
          if (isNaN(foundedYear)) {
            matchesYearRange = false;
          } else {
            matchesYearRange = foundedYear >= yearRangeFilter.min && foundedYear <= yearRangeFilter.max;
          }
        }
      }

      // Check area filter
      let matchesArea = true;
      if (hasAreaFilter) {
        if (!pub.area) {
          matchesArea = false;
        } else {
          matchesArea = pub.area.trim().toLowerCase() === areaFilter.trim().toLowerCase();
        }
      }

      // Pub must match all active filters (AND logic across filter types)
      return matchesFeatures && matchesOwnerships && matchesYearRange && matchesArea;
    });
    
    setPubs([...filtered]); // Create new array to trigger re-render
  };

  const handleFilterApply = (filters) => {
    const features = filters.features || [];
    const ownerships = filters.ownerships || [];
    const yearRangeFilter = filters.yearRange || null;
    
    setSelectedFeatures(features);
    setSelectedOwnerships(ownerships);
    setYearRange(yearRangeFilter);
    
    // Apply filters immediately using current allPubs
    const currentAllPubs = allPubs.length > 0 ? allPubs : [];
    if (currentAllPubs.length > 0) {
      applyFilters(currentAllPubs, features, ownerships, yearRangeFilter, selectedArea);
    }
  };

  // Also update when allPubs, selectedFeatures, selectedOwnerships, yearRange, or selectedArea changes
  useEffect(() => {
    if (allPubs && allPubs.length > 0) {
      applyFilters(allPubs, selectedFeatures, selectedOwnerships, yearRange, selectedArea);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPubs, selectedFeatures, selectedOwnerships, yearRange, selectedArea]);

  const handleFilterPress = () => {
    setShowFilterScreen(true);
  };

  const handleFilterClose = () => {
    setShowFilterScreen(false);
  };

  const closeCard = () => {
    // Lock the current region to prevent any map adjustments
    lockedRegionRef.current = { ...mapRegion };
    isClosingCardRef.current = true;
    setSelectedPub(null);
    // Reset flag after animation completes
    setTimeout(() => {
      isClosingCardRef.current = false;
      lockedRegionRef.current = null;
    }, 300);
  };
  
  const imageMap = {
    'assets/PubPhotos/Abbey_Arms.jpeg': require('../assets/PubPhotos/Abbey_Arms.jpeg'),
    'assets/PubPhotos/Birchwood.jpeg': require('../assets/PubPhotos/Birchwood.jpeg'),
    'assets/PubPhotos/George_&_Dragon.jpeg': require('../assets/PubPhotos/George_&_Dragon.jpg'),
    'assets/PubPhotos/George_&_Dragon.jpg': require('../assets/PubPhotos/George_&_Dragon.jpg'),
    'assets/PubPhotos/Red_Lion_&_Pineapple.jpeg': require('../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
    'assets/PubPhotos/Red_Lion_&_Pineapple.jpg': require('../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
  };
  
  const placeholderImage = require('../assets/PubPhotos/Placeholder.jpg');
  
  const getImageSource = (photoUrl) => {
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
  };

  const handleSearch = async (queryOverride = null) => {
    const queryToUse = queryOverride !== null ? queryOverride : searchQuery;
    if (!queryToUse.trim()) return;

    setShowSuggestions(false);
    Keyboard.dismiss();
    const query = queryToUse.trim().toLowerCase();
    
    // First check if query matches an area - if so, zoom to area (no card)
    const areas = getAllAreas();
    const matchingArea = areas.find(area => 
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
        lockedRegionRef.current = null;
        isClosingCardRef.current = false;
        
        const location = data[0];
        const newRegion = {
          latitude: parseFloat(location.lat),
          longitude: parseFloat(location.lon),
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        };
        setMapRegion(newRegion);
        mapRef.current?.animateToRegion(newRegion, 1000);
        // Don't set selectedPub for general searches - no pub card
        setSelectedPub(null);
      }
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  const clearSearch = () => {
    // Clear any region locks to allow navigation
    lockedRegionRef.current = null;
    isClosingCardRef.current = false;
    
    setSearchQuery('');
    setSelectedArea(null); // Clear area filter when clearing search
    setMapRegion(LONDON);
    mapRef.current?.animateToRegion(LONDON, 1000);
    setShowSuggestions(false);
    
    // Track which area was cleared to prevent re-applying it if route params come back
    const currentArea = route.params?.areaToSearch || processedAreaRef.current;
    if (currentArea) {
      clearedAreaRef.current = currentArea;
    }
    
    // Clear route params permanently so they don't come back when navigating away and back
    // Merge existing params and remove areaToSearch key to fully clear it
    const currentParams = route.params || {};
    const { areaToSearch, ...paramsWithoutArea } = currentParams;
    navigation.setParams(paramsWithoutArea);
    
    // Reset processed area ref
    processedAreaRef.current = null;
  };

  // Get unique areas from all pubs
  const getAllAreas = () => {
    const areaSet = new Set();
    allPubs.forEach(pub => {
      if (pub.area && pub.area.trim()) {
        areaSet.add(pub.area.trim());
      }
    });
    return Array.from(areaSet).sort();
  };

  // Calculate area statistics: total pubs, visited pubs, and completion percentage
  const calculateAreaStats = (areaName, pubsToAnalyze) => {
    const pubsInArea = pubsToAnalyze.filter(pub => 
      pub.area && pub.area.trim().toLowerCase() === areaName.toLowerCase()
    );
    
    const totalPubs = pubsInArea.length;
    const visitedPubs = pubsInArea.filter(pub => pub.isVisited).length;
    const completionPercentage = totalPubs > 0 ? (visitedPubs / totalPubs) * 100 : 0;
    
    return {
      totalPubs,
      visitedPubs,
      completionPercentage,
      pubs: pubsInArea
    };
  };

  // Interpolate color from grey to amber based on completion percentage (0-100)
  const interpolateColor = (percentage) => {
    // Convert hex colors to RGB
    const greyR = 0x75;
    const greyG = 0x75;
    const greyB = 0x75;
    const amberR = 0xD4;
    const amberG = 0xA0;
    const amberB = 0x17;
    
    // Interpolate between grey and amber
    const r = Math.round(greyR + (amberR - greyR) * (percentage / 100));
    const g = Math.round(greyG + (amberG - greyG) * (percentage / 100));
    const b = Math.round(greyB + (amberB - greyB) * (percentage / 100));
    
    // Convert back to hex
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Calculate center point of pubs in an area
  const getAreaCenter = (pubsInArea) => {
    const validPubs = pubsInArea.filter(pub => pub.lat && pub.lon);
    if (validPubs.length === 0) return null;
    
    const sumLat = validPubs.reduce((sum, pub) => sum + parseFloat(pub.lat), 0);
    const sumLon = validPubs.reduce((sum, pub) => sum + parseFloat(pub.lon), 0);
    
    return {
      latitude: sumLat / validPubs.length,
      longitude: sumLon / validPubs.length
    };
  };

  // Determine if we should show area markers based on current zoom level
  // Uses the maximum of latitudeDelta and longitudeDelta to ensure consistent behavior
  const shouldShowAreaMarkers = () => {
    if (!mapRegion || !mapRegion.latitudeDelta) return false;
    // Use max delta to handle cases where deltas differ slightly
    const maxDelta = Math.max(mapRegion.latitudeDelta, mapRegion.longitudeDelta || mapRegion.latitudeDelta);
    return maxDelta > AREA_ZOOM_THRESHOLD;
  };

  // Handle area marker press on map - zoom in to show individual pubs in that area
  const handleAreaMarkerPress = async (areaName) => {
    const areaStats = calculateAreaStats(areaName, pubs);
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
    
    // Clear any region locks to allow navigation
    lockedRegionRef.current = null;
    isClosingCardRef.current = false;
    isNavigatingRef.current = true;
    
    const newRegion = {
      latitude: center.latitude,
      longitude: center.longitude,
      latitudeDelta: Math.min(latDelta, AREA_ZOOM_THRESHOLD - 0.01), // Zoom in just below threshold
      longitudeDelta: Math.min(lonDelta, AREA_ZOOM_THRESHOLD - 0.01),
    };
    
    setMapRegion(newRegion);
    if (mapRef.current) {
      mapRef.current.animateToRegion(newRegion, 1000);
      
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 1050);
    } else {
      isNavigatingRef.current = false;
    }
    
    // Don't set selectedPub - just zoom in
    setSelectedPub(null);
  };

  // Filter areas based on search query
  const getAreaSuggestions = () => {
    const areas = getAllAreas();
    if (!searchQuery.trim()) {
      // Return first 3 alphabetical areas when no query
      return areas.slice(0, 3);
    }
    const query = searchQuery.trim().toLowerCase();
    return areas.filter(area => 
      area.toLowerCase().includes(query)
    ).slice(0, 3); // Limit to 3 suggestions
  };

  // Filter pub names based on search query
  const getPubSuggestions = () => {
    if (!searchQuery.trim()) {
      // Return first 3 alphabetical pub names when no query
      const sortedPubs = [...allPubs].sort((a, b) => {
        const nameA = (a.name || '').toLowerCase();
        const nameB = (b.name || '').toLowerCase();
        return nameA.localeCompare(nameB);
      });
      return sortedPubs.slice(0, 3);
    }
    const query = searchQuery.trim().toLowerCase();
    return allPubs.filter(pub => 
      pub.name?.toLowerCase().includes(query)
    ).slice(0, 3); // Limit to 3 suggestions
  };

  const handleSearchFocus = () => {
    setShowSuggestions(true);
  };

  const handleSearchBlur = () => {
    // Delay hiding to allow suggestion tap to register
    setTimeout(() => {
      setShowSuggestions(false);
    }, 200);
  };

  // Shared function to search for an area using pub coordinates
  // If applyAreaFilter is true, also filter pubs to only show pubs in that area
  const searchArea = async (areaName, applyAreaFilter = false) => {
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
        
        // Clear any region locks to allow search navigation
        lockedRegionRef.current = null;
        isClosingCardRef.current = false;
        isNavigatingRef.current = true;
        
        const newRegion = {
          latitude: centerLat,
          longitude: centerLon,
          latitudeDelta: Math.min(latDelta, 0.05), // Cap at reasonable zoom level
          longitudeDelta: Math.min(lonDelta, 0.05),
        };
        
        setMapRegion(newRegion);
        if (mapRef.current) {
          mapRef.current.animateToRegion(newRegion, 1000);
          
          // Reset navigation flag after animation completes
          setTimeout(() => {
            isNavigatingRef.current = false;
          }, 1050);
        } else {
          isNavigatingRef.current = false;
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
        // Clear any region locks to allow search navigation
        lockedRegionRef.current = null;
        isClosingCardRef.current = false;
        isNavigatingRef.current = true;
        
        const location = data[0];
        const newRegion = {
          latitude: parseFloat(location.lat),
          longitude: parseFloat(location.lon),
          latitudeDelta: 0.02,
          longitudeDelta: 0.02,
        };
        
        setMapRegion(newRegion);
        if (mapRef.current) {
          mapRef.current.animateToRegion(newRegion, 1000);
          
          setTimeout(() => {
            isNavigatingRef.current = false;
          }, 1050);
        } else {
          isNavigatingRef.current = false;
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
  };

  // Shared function to search for a pub
  const searchPub = (pub) => {
    // Clear any region locks to allow search navigation
    lockedRegionRef.current = null;
    isClosingCardRef.current = false;
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
      setMapRegion(newRegion);
      
      // Then animate the map
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
        
        // Reset navigation flag after animation completes
        setTimeout(() => {
          isNavigatingRef.current = false;
        }, 1050);
      } else {
        isNavigatingRef.current = false;
      }
      
      // Set the selected pub
      setSelectedPub(pub);
      return true; // Success
    } else {
      console.error('Pub missing coordinates:', pub);
      isNavigatingRef.current = false;
      return false; // Failed
    }
  };

  const handleAreaPress = async (area) => {
    setSearchQuery(area);
    setShowSuggestions(false);
    Keyboard.dismiss();
    
    // Use shared searchArea function
    await searchArea(area);
  };

  // Handle route params when navigating from ProfileScreen with an area to search
  const processedAreaRef = useRef(null);
  useFocusEffect(
    useCallback(() => {
      const areaToSearch = route.params?.areaToSearch;
      
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
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [route.params?.areaToSearch, allPubs.length])
  );

  const handlePubSuggestionPress = async (pub) => {
    setSearchQuery(pub.name);
    setShowSuggestions(false);
    Keyboard.dismiss();
    
    // Use shared searchPub function
    searchPub(pub);
  };

  const handleCurrentLocation = async () => {
    // Use cached location immediately for instant response
    if (currentLocation) {
      // Clear any region locks immediately
      lockedRegionRef.current = null;
      isClosingCardRef.current = false;
      isNavigatingRef.current = true;
      
      const newRegion = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      
      // Update region state
      setMapRegion(newRegion);
      
      // Animate immediately - no waiting for location fetch
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
      }
      
      // Clear navigation flag after animation completes
      setTimeout(() => {
        isNavigatingRef.current = false;
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

      // Clear any region locks immediately
      lockedRegionRef.current = null;
      isClosingCardRef.current = false;
      isNavigatingRef.current = true;
      
      // Update region state
      setMapRegion(newRegion);
      
      // Animate quickly - reduced duration for faster response 
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
      }
      
      // Clear navigation flag after animation completes
      setTimeout(() => {
        isNavigatingRef.current = false;
      }, 1050);
    } catch (error) {
      console.error('Error getting location:', error);
      isNavigatingRef.current = false;
    }
  };

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
        areaSuggestions={getAreaSuggestions()}
        pubSuggestions={getPubSuggestions()}
        onAreaPress={handleAreaPress}
        onPubPress={handlePubSuggestionPress}
        keyboardHeight={keyboardHeight}
        keyboardTop={keyboardTop}
      />
      
      <FilterScreen
        visible={showFilterScreen}
        onClose={handleFilterClose}
        allFeatures={getAllFeatures()}
        selectedFeatures={selectedFeatures}
        allOwnerships={getAllOwnerships()}
        selectedOwnerships={selectedOwnerships}
        yearRange={yearRange}
        minYear={getYearRange().min}
        maxYear={getYearRange().max}
        onApply={handleFilterApply}
      />
      
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={mapRegion}
        region={isClosingCardRef.current && lockedRegionRef.current ? lockedRegionRef.current : mapRegion}
        onRegionChangeComplete={(region) => {
          // Ignore region changes while closing the card or during programmatic navigation
          if (isClosingCardRef.current || isNavigatingRef.current) {
            return;
          }
          // Always update region state - this keeps it in sync
          // During programmatic navigation, this syncs with the animated region
          setMapRegion(region);
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
        
        {shouldShowAreaMarkers() ? (
          // Show area markers when zoomed out
          (() => {
            // Get unique areas from filtered pubs only
            const areaSet = new Set();
            pubs.forEach(pub => {
              if (pub.area && pub.area.trim()) {
                areaSet.add(pub.area.trim());
              }
            });
            const visibleAreas = Array.from(areaSet);
            
            return visibleAreas.map((areaName) => {
              const areaStats = calculateAreaStats(areaName, pubs);
              const center = getAreaCenter(areaStats.pubs);
              
              if (!center || areaStats.totalPubs === 0) return null;
            
            const areaColor = interpolateColor(areaStats.completionPercentage);
            
            return (
              <Marker
                key={`area-${areaName}`}
                coordinate={center}
                onPress={() => handleAreaMarkerPress(areaName)}
              >
                <View style={styles.markerContainer}>
                  <AreaIcon 
                    size={36} 
                    color={areaColor}
                  />
                </View>
              </Marker>
            );
            });
          })()
        ) : (
          // Show individual pub markers when zoomed in
          pubs.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            onPress={() => handlePubPress(p)}
          >
            <View style={styles.markerContainer}>
              <PintGlassIcon 
                size={28} 
                color={p.isVisited ? AMBER : MEDIUM_GREY} 
              />
            </View>
          </Marker>
          ))
        )}
      </MapView>

      <TouchableOpacity 
        style={[styles.locationButton, { 
          bottom: insets.bottom - 24 + (selectedPub ? cardHeight + 0: 0)
        }]}
        onPress={handleCurrentLocation}
      >
        <MaterialCommunityIcons name="crosshairs-gps" size={24} color={AMBER} />
      </TouchableOpacity>
      
      <DraggablePubCard 
        pub={selectedPub}
        onClose={closeCard}
        onToggleVisited={handleToggleVisited}
        getImageSource={getImageSource}
      />
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