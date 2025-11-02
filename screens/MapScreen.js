import React, { useEffect, useState, useRef, useCallback } from 'react';
import { 
  View, 
  Dimensions, 
  TouchableOpacity, 
  StyleSheet
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import MapView, { Marker } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchLondonPubs, togglePubVisited } from '../services/PubService';
import PintGlassIcon from '../components/PintGlassIcon';
import SearchBar from '../components/SearchBar';
import DraggablePubCard from '../components/DraggablePubCard';
import FilterScreen from './FilterScreen';

const LONDON = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.1, longitudeDelta: 0.1 };

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
  const [pubs, setPubs] = useState([]);
  const [allPubs, setAllPubs] = useState([]); // Store unfiltered pubs
  const [selectedPub, setSelectedPub] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapRegion, setMapRegion] = useState(LONDON);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [heading, setHeading] = useState(0);
  const [showFilterScreen, setShowFilterScreen] = useState(false);
  const [selectedFeatures, setSelectedFeatures] = useState([]);
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
          await Location.enableNetworkProviderAsync();
          
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setCurrentLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
          
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
        }
      } catch (error) {
        console.error('Location setup error:', error);
      }
    };
    
    setupLocation();
    
    return () => {
      locationSubscriptionRef.current?.remove();
    };
  }, []);

  const handlePubPress = (pub) => {
    setSelectedPub(pub);
  };

  const handleToggleVisited = async (pubId) => {
    await togglePubVisited(pubId);
    const updatedPubs = await fetchLondonPubs();
    setAllPubs(updatedPubs);
    applyFilters(updatedPubs, selectedFeatures);
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

  // Apply filters to pubs
  const applyFilters = (pubsToFilter, features) => {
    if (!pubsToFilter || pubsToFilter.length === 0) {
      // If no pubs to filter, just show empty or wait for data
      return;
    }
    
    if (!features || features.length === 0) {
      setPubs([...pubsToFilter]); // Create new array to trigger re-render
      return;
    }

    const filtered = pubsToFilter.filter(pub => {
      if (!pub.features || !Array.isArray(pub.features)) return false;
      // Pub must have ALL of the selected features (AND logic)
      // Each selected feature must be present in the pub's features (case-sensitive exact match)
      return features.every(selectedFeature => {
        // Check if pub has this exact feature (case-sensitive matching)
        return pub.features.includes(selectedFeature);
      });
    });
    
    setPubs([...filtered]); // Create new array to trigger re-render
  };

  const handleFilterApply = (features) => {
    setSelectedFeatures(features);
    // Apply filters immediately using current allPubs
    // Get the latest allPubs value directly
    const currentAllPubs = allPubs.length > 0 ? allPubs : [];
    if (currentAllPubs.length > 0) {
      applyFilters(currentAllPubs, features);
    }
  };

  // Also update when allPubs or selectedFeatures changes (to handle initial load and filter changes)
  useEffect(() => {
    if (allPubs && allPubs.length > 0) {
      if (selectedFeatures && selectedFeatures.length > 0) {
        applyFilters(allPubs, selectedFeatures);
      } else {
        setPubs([...allPubs]);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPubs, selectedFeatures]);

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
    
    if (photoUrl.startsWith('assets/')) {
      if (imageMap[photoUrl]) return imageMap[photoUrl];
      const jpgUrl = photoUrl.replace('.jpeg', '.jpg');
      if (imageMap[jpgUrl]) return imageMap[jpgUrl];
      const jpegUrl = photoUrl.replace('.jpg', '.jpeg');
      if (imageMap[jpegUrl]) return imageMap[jpegUrl];
      return placeholderImage;
    }
    return placeholderImage;
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    const query = searchQuery.trim().toLowerCase();
    const matchingPub = pubs.find(pub => 
      pub.name?.toLowerCase().includes(query) || pub.area?.toLowerCase().includes(query)
    );

    if (matchingPub) {
      // Clear any region locks to allow search navigation
      lockedRegionRef.current = null;
      isClosingCardRef.current = false;
      
      const newRegion = {
        latitude: matchingPub.lat,
        longitude: matchingPub.lon,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      setMapRegion(newRegion);
      mapRef.current?.animateToRegion(newRegion, 1000);
      setSelectedPub(matchingPub);
      return;
    }
    try {
      const encodedQuery = encodeURIComponent(`${searchQuery}, London, UK`);
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
    setMapRegion(LONDON);
    mapRef.current?.animateToRegion(LONDON, 1000);
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
      />
      
      <FilterScreen
        visible={showFilterScreen}
        onClose={handleFilterClose}
        allFeatures={getAllFeatures()}
        selectedFeatures={selectedFeatures}
        onApply={handleFilterApply}
      />
      
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={LONDON}
        region={isClosingCardRef.current && lockedRegionRef.current ? lockedRegionRef.current : mapRegion}
        onRegionChangeComplete={(region) => {
          // Ignore region changes while closing the card
          if (isClosingCardRef.current) {
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
        
        {pubs.map((p) => (
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
        ))}
      </MapView>

      <TouchableOpacity 
        style={[styles.locationButton, { 
          bottom: insets.bottom + (selectedPub ? cardHeight + 0: 0)
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