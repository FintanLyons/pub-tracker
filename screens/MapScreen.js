import React, { useEffect, useState, useRef } from 'react';
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

const LONDON = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.1, longitudeDelta: 0.1 };

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const AMBER = '#D4A017';
const DARK_CHARCOAL = '#1C1C1C';

// Custom map style with subtly lighter, more muted colors (halfway between original and muted)
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
  const [selectedPub, setSelectedPub] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mapRegion, setMapRegion] = useState(LONDON);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [heading, setHeading] = useState(0);
  const [isCardExpanded, setIsCardExpanded] = useState(false);
  const mapRef = useRef(null);
  const locationSubscriptionRef = useRef(null);
  const screenHeight = Dimensions.get('window').height;
  const cardHeight = screenHeight * 0.33;
  const TAB_BAR_HEIGHT = 0; // Base height of tab bar

  useEffect(() => {
    fetchLondonPubs().then(setPubs);
    
    // Request location permissions and start watching location
    const setupLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          // Enable location services
          await Location.enableNetworkProviderAsync();
          
          // Get initial location
          const location = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          setCurrentLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          });
          
          // Watch position for updates
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
              // Update heading if available
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
    
    // Cleanup on unmount
    return () => {
      if (locationSubscriptionRef.current) {
        locationSubscriptionRef.current.remove();
      }
    };
  }, []);

  const handlePubPress = (pub) => {
    setSelectedPub(pub);
  };

  const handleToggleVisited = async (pubId) => {
    await togglePubVisited(pubId);
    const updatedPubs = await fetchLondonPubs();
    setPubs(updatedPubs);
    // Update selected pub if it's the one we toggled
    if (selectedPub && selectedPub.id === pubId) {
      const updatedPub = updatedPubs.find(p => p.id === pubId);
      if (updatedPub) setSelectedPub(updatedPub);
    }
  };

  const closeCard = () => {
    setSelectedPub(null);
  };
  
  // Image mapping for local assets - linked to JSON file photoUrl values
  // This map should match the photoUrl values in pubs_data_short.js
  const imageMap = {
    'assets/PubPhotos/Abbey_Arms.jpeg': require('../assets/PubPhotos/Abbey_Arms.jpeg'),
    'assets/PubPhotos/Birchwood.jpeg': require('../assets/PubPhotos/Birchwood.jpeg'),
    'assets/PubPhotos/George_&_Dragon.jpeg': require('../assets/PubPhotos/George_&_Dragon.jpg'),
    'assets/PubPhotos/George_&_Dragon.jpg': require('../assets/PubPhotos/George_&_Dragon.jpg'),
    'assets/PubPhotos/Red_Lion_&_Pineapple.jpeg': require('../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
    'assets/PubPhotos/Red_Lion_&_Pineapple.jpg': require('../assets/PubPhotos/Red_Lion_&_Pineapple.jpg'),
  };
  
  // Placeholder image for pubs without photos in assets
  const placeholderImage = require('../assets/PubPhotos/Placeholder.jpg');
  
  // Get image source for pub photo
  // This function checks the imageMap using the photoUrl from JSON
  // If not found, returns placeholder image
  const getImageSource = (photoUrl) => {
    if (!photoUrl) return placeholderImage;
    
    // Check if it's a local asset path
    if (photoUrl.startsWith('assets/')) {
      // Try exact match first (as it appears in JSON)
      if (imageMap[photoUrl]) {
        return imageMap[photoUrl];
      }
      // Try with .jpg extension if .jpeg was provided
      const jpgUrl = photoUrl.replace('.jpeg', '.jpg');
      if (imageMap[jpgUrl]) {
        return imageMap[jpgUrl];
      }
      // Try with .jpeg extension if .jpg was provided
      const jpegUrl = photoUrl.replace('.jpg', '.jpeg');
      if (imageMap[jpegUrl]) {
        return imageMap[jpegUrl];
      }
      // If local asset path but not in map, use placeholder
      return placeholderImage;
    }
    // External URL (like placekitten) - use placeholder instead
    // since these pubs don't have photos in the assets folder
    return placeholderImage;
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    const query = searchQuery.trim().toLowerCase();

    // First, search through pub names and areas
    const matchingPub = pubs.find(pub => {
      const nameMatch = pub.name?.toLowerCase().includes(query);
      const areaMatch = pub.area?.toLowerCase().includes(query);
      return nameMatch || areaMatch;
    });

    if (matchingPub) {
      // Found a pub match - zoom into that pub location (2x further out than before)
      const newRegion = {
        latitude: matchingPub.lat,
        longitude: matchingPub.lon,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };
      
      setMapRegion(newRegion);
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
      }
      
      // Open the pub card
      setSelectedPub(matchingPub);
      return;
    }

    // If no pub match, try geocoding for area/location search
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
        }
      }
    } catch (error) {
      console.error('Search error:', error);
    }
  };

  const clearSearch = () => {
    setSearchQuery('');
    // Optionally reset map to original London view
    setMapRegion(LONDON);
    if (mapRef.current) {
      mapRef.current.animateToRegion(LONDON, 1000);
    }
  };

  const handleCurrentLocation = async () => {
    try {
      // Request location permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission denied');
        return;
      }

      // Get current location
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const newRegion = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      };

      setMapRegion(newRegion);
      if (mapRef.current) {
        mapRef.current.animateToRegion(newRegion, 1000);
      }
    } catch (error) {
      console.error('Error getting location:', error);
    }
  };

  const tabBarHeight = TAB_BAR_HEIGHT + insets.bottom;

  return (
    <View style={styles.container}>
      <SearchBar 
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        onSearch={handleSearch}
        onClear={clearSearch}
      />
      
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFillObject}
        initialRegion={LONDON}
        region={mapRegion}
        onRegionChangeComplete={setMapRegion}
        customMapStyle={customMapStyle}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsBuildings={false}
        showsIndoors={false}
        showsPointsOfInterest={false}
        zoomControlEnabled={false}
        rotateEnabled={false}
        scrollEnabled={true}
        pitchEnabled={false}
        toolbarEnabled={false}
        mapPadding={{
          top: 0,
          right: 0,
          bottom: selectedPub ? (isCardExpanded ? screenHeight - insets.top : cardHeight) : 0,
          left: 0,
        }}
        googleMapId=""
        liteMode={false}
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
          bottom: tabBarHeight + (selectedPub ? cardHeight + 16 : 16)
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
        onCardStateChange={(expanded) => {
          setIsCardExpanded(expanded);
          // Update map padding to move Google controls above the card
          if (mapRef.current && selectedPub) {
            const padding = {
              top: 0,
              right: 0,
              bottom: expanded ? screenHeight - insets.top: cardHeight,
              left: 0,
            };
            // Use setCamera or animateCamera to update padding smoothly
            try {
              mapRef.current.setCamera({ padding });
            } catch (e) {
              // Fallback if setCamera doesn't work
              console.log('Could not update map padding:', e);
            }
          }
        }}
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