import React from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const DARK_GREY = '#2C2C2C';
const MEDIUM_GREY = '#757575';
const LIGHT_GREY = '#F5F5F5';

export default function PubCardContent({ 
  pub, 
  isExpanded, 
  onToggleVisited,
  getImageSource 
}) {
  return (
    <ScrollView 
      style={styles.cardContent}
      showsVerticalScrollIndicator={false}
      scrollEnabled={isExpanded}
    >
      <Text style={styles.pubName}>{pub.name}</Text>
      
      {pub.area && (
        <Text style={styles.area}>{pub.area}</Text>
      )}
      
      {pub.photoUrl && (
        <View style={styles.photoContainer}>
          <Image 
            source={getImageSource(pub.photoUrl)} 
            style={styles.pubPhoto}
            resizeMode="cover"
          />
        </View>
      )}
      
      {pub.address && (
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="map-marker" size={16} color={MEDIUM_GREY} />
          <Text style={styles.address}>{pub.address.replace(/\n+/g, ' ').trim()}</Text>
        </View>
      )}
      
      {pub.phone && (
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="phone" size={16} color={MEDIUM_GREY} />
          <Text style={styles.phone}>{pub.phone}</Text>
        </View>
      )}
      
      {pub.ownership && (
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="office-building" size={16} color={MEDIUM_GREY} />
          <Text style={styles.ownership}>{pub.ownership}</Text>
        </View>
      )}
      
      {pub.description && isExpanded && (
        <Text style={styles.description}>{pub.description}</Text>
      )}
      
      <TouchableOpacity
        style={[
          styles.visitedButton,
          pub.isVisited && styles.visitedButtonActive
        ]}
        onPress={() => onToggleVisited(pub.id)}
      >
        <MaterialCommunityIcons
          name={pub.isVisited ? 'check-circle' : 'checkbox-blank-circle-outline'}
          size={24}
          color={pub.isVisited ? '#FFFFFF' : DARK_GREY}
        />
        <Text style={[
          styles.visitedButtonText,
          pub.isVisited && styles.visitedButtonTextActive
        ]}>
          {pub.isVisited ? 'Visited' : 'Mark as Visited'}
        </Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
  photoContainer: {
    width: '100%',
    height: 200,
    marginVertical: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: LIGHT_GREY,
  },
  pubPhoto: {
    width: '100%',
    height: '100%',
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
  ownership: {
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

