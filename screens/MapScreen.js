import React, { useEffect, useState } from 'react';
import { View, Dimensions } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { fetchLondonPubs, togglePubVisited } from '../services/PubService';

const LONDON = { latitude: 51.5074, longitude: -0.1278, latitudeDelta: 0.1, longitudeDelta: 0.1 };

export default function MapScreen() {
  const [pubs, setPubs] = useState([]);

  useEffect(() => {
    fetchLondonPubs().then(setPubs);
  }, []);

  const toggle = async (id) => {
    await togglePubVisited(id);
    setPubs(await fetchLondonPubs());
  };

  return (
    <View style={{ flex: 1 }}>
      <MapView
        style={{ width: Dimensions.get('window').width, height: Dimensions.get('window').height }}
        initialRegion={LONDON}
      >
        {pubs.map((p) => (
          <Marker
            key={p.id}
            coordinate={{ latitude: p.lat, longitude: p.lon }}
            pinColor={p.isVisited ? 'gray' : 'blue'}
            onPress={() => toggle(p.id)}
          />
        ))}
      </MapView>
    </View>
  );
}