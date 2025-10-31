import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { fetchLondonPubs } from '../services/PubService';
export default function ProfileScreen() {
  const [v, setV] = useState(0), [t, setT] = useState(0);
  useEffect(() => { fetchLondonPubs().then(pubs => { setT(pubs.length); setV(pubs.filter(p => p.isVisited).length); }); }, []);
  return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text>Visited: {v} / {t}</Text></View>;
}