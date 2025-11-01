import React, { useEffect, useState } from 'react';
import { 
  View, 
  Dimensions, 
  ScrollView, 
  Text, 
  TouchableOpacity, 
  StyleSheet
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchLondonPubs, togglePubVisited } from '../services/PubService';
import PintGlassIcon from '../components/PintGlassIcon';

const LONDON = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.1, longitudeDelta: 0.1 };

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';

export default function MapScreen() {
  const [pubs, setPubs] = useState([]);
  const [selectedPub, setSelectedPub] = useState(null);
  const screenHeight = Dimensions.get('window').height;
  const cardHeight = screenHeight * 0.33;

  useEffect(() => {
    fetchLondonPubs().then(setPubs);
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

  return (
    <View style={styles.container}>
      <MapView
        style={StyleSheet.absoluteFillObject}
        initialRegion={LONDON}
      >
        {pubs.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            onPress={() => handlePubPress(p)}
          >
            <View style={styles.markerContainer}>
              <PintGlassIcon 
                size={28} 
                color={p.isVisited ? DARK_GREY : '#CC0000'} 
              />
            </View>
          </Marker>
        ))}
      </MapView>
      
      {selectedPub && (
        <View style={[styles.cardContainer, { height: cardHeight }]}>
          <View style={styles.cardHandle} />
          <TouchableOpacity 
            style={styles.closeButton} 
            onPress={closeCard}
          >
            <MaterialCommunityIcons name="close" size={24} color={MEDIUM_GREY} />
          </TouchableOpacity>
          
          <ScrollView 
            style={styles.cardContent}
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.pubName}>{selectedPub.name}</Text>
            
            {selectedPub.area && (
              <Text style={styles.area}>{selectedPub.area}</Text>
            )}
            
            {selectedPub.address && (
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="map-marker" size={16} color={MEDIUM_GREY} />
                <Text style={styles.address}>{selectedPub.address}</Text>
              </View>
            )}
            
            {selectedPub.phone && (
              <View style={styles.infoRow}>
                <MaterialCommunityIcons name="phone" size={16} color={MEDIUM_GREY} />
                <Text style={styles.phone}>{selectedPub.phone}</Text>
              </View>
            )}
            
            {selectedPub.description && (
              <Text style={styles.description}>{selectedPub.description}</Text>
            )}
            
            <TouchableOpacity
              style={[
                styles.visitedButton,
                selectedPub.isVisited && styles.visitedButtonActive
              ]}
              onPress={() => handleToggleVisited(selectedPub.id)}
            >
              <MaterialCommunityIcons
                name={selectedPub.isVisited ? 'check-circle' : 'checkbox-blank-circle-outline'}
                size={24}
                color={selectedPub.isVisited ? '#FFFFFF' : DARK_GREY}
              />
              <Text style={[
                styles.visitedButtonText,
                selectedPub.isVisited && styles.visitedButtonTextActive
              ]}>
                {selectedPub.isVisited ? 'Visited' : 'Mark as Visited'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
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
  markerContainer: {
    backgroundColor: 'transparent',
  },
  cardContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  cardHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    backgroundColor: MEDIUM_GREY,
    borderRadius: 2,
    marginBottom: 12,
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 16,
    zIndex: 1,
    padding: 4,
  },
  cardContent: {
    flex: 1,
  },
  pubName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginBottom: 4,
    paddingRight: 40,
  },
  area: {
    fontSize: 14,
    color: MEDIUM_GREY,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  address: {
    fontSize: 14,
    color: DARK_GREY,
    marginLeft: 8,
    flex: 1,
  },
  phone: {
    fontSize: 14,
    color: DARK_GREY,
    marginLeft: 8,
  },
  description: {
    fontSize: 14,
    color: DARK_GREY,
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 16,
  },
  visitedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_GREY,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginTop: 8,
    borderWidth: 2,
    borderColor: DARK_GREY,
  },
  visitedButtonActive: {
    backgroundColor: DARK_GREY,
    borderColor: DARK_GREY,
  },
  visitedButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_GREY,
    marginLeft: 8,
  },
  visitedButtonTextActive: {
    color: '#FFFFFF',
  },
});