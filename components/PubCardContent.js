import React from 'react';
import { View, Text, ScrollView, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const DARK_GREY = '#2C2C2C';
const MEDIUM_GREY = '#757575';
const LIGHT_GREY = '#F5F5F5';

// Feature icon mapping
const getFeatureIcon = (feature) => {
  const featureLower = feature.toLowerCase();
  const iconMap = {
    'live music': 'music',
    'beer garden': 'tree',
    'dog friendly': 'dog',
    'food': 'food',
    'wifi': 'wifi',
    'parking': 'parking',
    'quiz': 'book-open-variant',
    'sports': 'soccer',
    'pool': 'pool',
    'darts': 'target',
    'outdoor seating': 'table-chair',
    'wheelchair accessible': 'wheelchair-accessibility',
  };
  
  // Try exact match first
  if (iconMap[featureLower]) {
    return iconMap[featureLower];
  }
  
  // Try partial matches
  for (const [key, icon] of Object.entries(iconMap)) {
    if (featureLower.includes(key) || key.includes(featureLower)) {
      return icon;
    }
  }
  
  // Default icon
  return 'star';
};

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
      
      <View style={styles.areaRow}>
        {pub.area && (
          <Text style={styles.area}>{pub.area}</Text>
        )}
        {pub.ownership && (
          <Text style={styles.ownershipInline}>{pub.ownership}</Text>
        )}
      </View>
      
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
      
      {pub.photoUrl && (
        <View style={styles.photoContainer}>
          <Image 
            source={getImageSource(pub.photoUrl)} 
            style={styles.pubPhoto}
            resizeMode="cover"
          />
        </View>
      )}
      
      {pub.features && pub.features.length > 0 && (
        <View style={styles.featuresContainer}>
          {pub.features.map((feature, index) => (
            <View key={index} style={styles.featureItem}>
              <MaterialCommunityIcons 
                name={getFeatureIcon(feature)} 
                size={18} 
                color={MEDIUM_GREY} 
              />
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
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
      
      {pub.founded && (
        <View style={styles.infoRow}>
          <MaterialCommunityIcons name="calendar" size={16} color={MEDIUM_GREY} />
          <Text style={styles.founded}>Founded: {pub.founded}</Text>
        </View>
      )}
      
      {pub.history && (
        <View style={styles.historyContainer}>
          <MaterialCommunityIcons name="book-open-page-variant" size={16} color={MEDIUM_GREY} />
          <Text style={styles.history}>{pub.history}</Text>
        </View>
      )}
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
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  area: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginRight: 12,
  },
  ownershipInline: {
    fontSize: 14,
    color: MEDIUM_GREY,
    fontWeight: '500',
  },
  visitedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LIGHT_GREY,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 12,
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
  photoContainer: {
    width: '100%',
    height: 200,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: LIGHT_GREY,
  },
  pubPhoto: {
    width: '100%',
    height: '100%',
  },
  featuresContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '50%',
    marginBottom: 8,
    paddingRight: 8,
  },
  featureText: {
    fontSize: 14,
    color: DARK_GREY,
    marginLeft: 6,
    flex: 1,
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
  founded: {
    fontSize: 14,
    color: DARK_GREY,
    marginLeft: 8,
  },
  historyContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 8,
    marginBottom: 16,
  },
  history: {
    fontSize: 14,
    color: DARK_GREY,
    marginLeft: 8,
    flex: 1,
    lineHeight: 20,
  },
});

