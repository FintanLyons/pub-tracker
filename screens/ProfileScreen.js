import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, Animated, Alert } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { fetchLondonPubs } from '../services/PubService';
import { getCurrentUserSecure } from '../services/SecureAuthService';
import { useAuth } from '../contexts/AuthContext';
import PintGlassIcon from '../components/PintGlassIcon';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const ACCENT_GREY = '#424242';

const SORT_MODES = {
  LOCATION: 'location',
  ALPHABETICAL: 'alphabetical',
  MOST_VISITED: 'most_visited',
  PERCENTAGE: 'percentage',
};

export default function ProfileScreen() {
  const navigation = useNavigation();
  const { logout } = useAuth();
  const [pubs, setPubs] = useState([]);
  const [visitedCount, setVisitedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [areaStats, setAreaStats] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [sortMode, setSortMode] = useState(SORT_MODES.LOCATION);
  const [showFilterModal, setShowFilterModal] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const slideAnim = useRef(new Animated.Value(0)).current;
  const isFirstRender = useRef(true);

  const handleAreaPress = (areaName) => {
    // Navigate to Map tab and pass the area name as a parameter
    navigation.navigate('Map', { areaToSearch: areaName });
  };

  // Calculate distance between two coordinates using Haversine formula (in km)
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Get user's current location
  const getCurrentLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
    } catch (error) {
      console.error('Error getting location:', error);
      return null;
    }
  }, []);

  const loadStats = useCallback(async () => {
    // Load current user
    const user = await getCurrentUserSecure();
    setCurrentUser(user);

    const allPubs = await fetchLondonPubs();
    setPubs(allPubs);
    setTotalCount(allPubs.length);
    const visited = allPubs.filter(p => p.isVisited);
    setVisitedCount(visited.length);

    // Get current location if we don't have it and location sorting is needed
    // Make sure location is fetched BEFORE calculating area breakdown when sorting by location
    let userLocation = currentLocation;
    if (!userLocation && sortMode === SORT_MODES.LOCATION) {
      userLocation = await getCurrentLocation();
      if (userLocation) {
        setCurrentLocation(userLocation);
      }
    }

    // Calculate area breakdown
    const areaMap = {};
    const areaRepresentativePub = {}; // Store one pub per area for distance calculation
    
    allPubs.forEach(pub => {
      const area = pub.area || 'Unknown';
      if (!areaMap[area]) {
        areaMap[area] = { total: 0, visited: 0 };
        // Store the first pub with valid coordinates as representative for this area
        if (pub.lat && pub.lon) {
          areaRepresentativePub[area] = {
            lat: parseFloat(pub.lat),
            lon: parseFloat(pub.lon),
          };
        }
      }
      areaMap[area].total++;
      if (pub.isVisited) {
        areaMap[area].visited++;
      }
      // If we don't have a representative pub yet for this area, use this one if it has coordinates
      if (!areaRepresentativePub[area] && pub.lat && pub.lon) {
        areaRepresentativePub[area] = {
          lat: parseFloat(pub.lat),
          lon: parseFloat(pub.lon),
        };
      }
    });

    // Create stats with distance if location is available
    let stats = Object.entries(areaMap)
      .map(([area, counts]) => {
        const percentage = counts.total > 0 ? Math.round((counts.visited / counts.total) * 100) : 0;
        let distance = null;
        
        // Only calculate distance if we have both userLocation and a representative pub for this area
        if (userLocation && areaRepresentativePub[area]) {
          try {
            distance = calculateDistance(
              userLocation.latitude,
              userLocation.longitude,
              areaRepresentativePub[area].lat,
              areaRepresentativePub[area].lon
            );
          } catch (error) {
            console.error(`Error calculating distance for area ${area}:`, error);
            distance = null;
          }
        }

        return {
          area,
          ...counts,
          percentage,
          distance,
        };
      });

    // Sort based on sort mode
    switch (sortMode) {
      case SORT_MODES.LOCATION:
        stats = stats.sort((a, b) => {
          // If both have distances, sort by distance
          if (a.distance !== null && b.distance !== null) {
            return a.distance - b.distance;
          }
          // If only one has distance, prioritize it
          if (a.distance !== null && b.distance === null) return -1;
          if (a.distance === null && b.distance !== null) return 1;
          // If neither has distance, sort alphabetically
          return a.area.localeCompare(b.area);
        });
        break;
      case SORT_MODES.ALPHABETICAL:
        stats = stats.sort((a, b) => a.area.localeCompare(b.area));
        break;
      case SORT_MODES.MOST_VISITED:
        stats = stats.sort((a, b) => b.visited - a.visited || b.total - a.total);
        break;
      case SORT_MODES.PERCENTAGE:
        stats = stats.sort((a, b) => b.percentage - a.percentage || b.visited - a.visited);
        break;
      default:
        break;
    }

    setAreaStats(stats);
  }, [currentLocation, sortMode, getCurrentLocation]);

  useFocusEffect(
    useCallback(() => {
      loadStats();
    }, [loadStats])
  );

  // Reload stats when sort mode changes (but not on initial mount)
  useEffect(() => {
    // Skip initial mount - useFocusEffect handles that
    if (totalCount > 0) {
      loadStats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortMode]);

  // Animate modal content slide
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    
    if (showFilterModal) {
      // Reset to bottom position and animate up
      slideAnim.setValue(300);
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      // Animate down when closing
      Animated.timing(slideAnim, {
        toValue: 300,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showFilterModal]);

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await logout();
            // AuthContext will automatically update and show AuthScreen
          },
        },
      ]
    );
  };

  const progressPercentage = totalCount > 0 ? Math.round((visitedCount / totalCount) * 100) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.headerContainer}>
        <View style={styles.spacer} />
      <View style={styles.header}>
        <PintGlassIcon size={48} color={DARK_GREY} />
        <Text style={styles.title}>Pub Tracker</Text>
          {currentUser && (
            <Text style={styles.username}>@{currentUser.username}</Text>
          )}
        </View>
        {currentUser && (
          <TouchableOpacity 
            onPress={handleLogout}
            style={styles.logoutButtonHeader}
          >
            <MaterialCommunityIcons name="logout" size={24} color="#F44336" />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.statsCard}>
        <View style={styles.mainStat}>
          <Text style={styles.visitedNumber}>{visitedCount}</Text>
          <Text style={styles.totalNumber}>/ {totalCount}</Text>
        </View>
        <Text style={styles.statLabel}>Pubs Visited</Text>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View 
              style={[styles.progressBarFill, { width: `${progressPercentage}%` }]} 
            />
          </View>
          <Text style={styles.progressText}>{progressPercentage}%</Text>
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionTitleContainer}>
          <Text style={styles.sectionTitle}>Breakdown by Area</Text>
          <TouchableOpacity 
            onPress={() => setShowFilterModal(true)}
            style={styles.filterButton}
          >
            <MaterialCommunityIcons name="filter-variant" size={20} color={DARK_GREY} />
          </TouchableOpacity>
        </View>
        {areaStats.length === 0 ? (
          <Text style={styles.emptyText}>No areas found</Text>
        ) : (
          areaStats.map((stat, index) => (
            <TouchableOpacity 
              key={index} 
              style={styles.areaCard}
              onPress={() => handleAreaPress(stat.area)}
              activeOpacity={0.7}
            >
              <View style={styles.areaHeader}>
                <Text style={styles.areaName}>{stat.area}</Text>
                <Text style={styles.areaCount}>
                  {stat.visited} / {stat.total}
                </Text>
              </View>
              <View style={styles.areaProgressBarContainer}>
                <View style={styles.areaProgressBarBackground}>
                  <View 
                    style={[
                      styles.areaProgressBarFill, 
                      { width: `${stat.percentage}%` }
                    ]} 
                  />
                </View>
                <Text style={styles.areaPercentage}>{stat.percentage}%</Text>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>

      <Modal
        visible={showFilterModal}
        animationType="none"
        transparent={true}
        onRequestClose={() => setShowFilterModal(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity 
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setShowFilterModal(false)}
          />
          <Animated.View 
            style={[
              styles.modalContent,
              {
                transform: [{ translateY: slideAnim }],
              },
            ]}
          >
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Sort by</Text>
              <TouchableOpacity 
                onPress={() => setShowFilterModal(false)}
                style={styles.modalCloseButton}
              >
                <MaterialCommunityIcons name="close" size={24} color={DARK_GREY} />
              </TouchableOpacity>
            </View>
            
            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.LOCATION && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.LOCATION);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.LOCATION && styles.filterOptionTextSelected
              ]}>
                Location (Distance)
              </Text>
              {sortMode === SORT_MODES.LOCATION && (
                <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.ALPHABETICAL && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.ALPHABETICAL);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.ALPHABETICAL && styles.filterOptionTextSelected
              ]}>
                Alphabetical
              </Text>
              {sortMode === SORT_MODES.ALPHABETICAL && (
                <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.MOST_VISITED && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.MOST_VISITED);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.MOST_VISITED && styles.filterOptionTextSelected
              ]}>
                Most Pubs Visited
              </Text>
              {sortMode === SORT_MODES.MOST_VISITED && (
                <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.filterOption,
                sortMode === SORT_MODES.PERCENTAGE && styles.filterOptionSelected
              ]}
              onPress={() => {
                setSortMode(SORT_MODES.PERCENTAGE);
                setShowFilterModal(false);
              }}
            >
              <Text style={[
                styles.filterOptionText,
                sortMode === SORT_MODES.PERCENTAGE && styles.filterOptionTextSelected
              ]}>
                Percentage Visited
              </Text>
              {sortMode === SORT_MODES.PERCENTAGE && (
                <MaterialCommunityIcons name="check" size={20} color={DARK_GREY} />
              )}
            </TouchableOpacity>
          </Animated.View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  contentContainer: {
    padding: 20,
    paddingTop: 40,
  },
  headerContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  spacer: {
    width: 40,
  },
  header: {
    flex: 1,
    alignItems: 'center',
  },
  logoutButtonHeader: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: LIGHT_GREY,
    marginTop: 8,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginTop: 12,
  },
  username: {
    fontSize: 16,
    color: MEDIUM_GREY,
    marginTop: 4,
  },
  statsCard: {
    backgroundColor: LIGHT_GREY,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  mainStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  visitedNumber: {
    fontSize: 56,
    fontWeight: 'bold',
    color: DARK_GREY,
  },
  totalNumber: {
    fontSize: 32,
    fontWeight: '600',
    color: MEDIUM_GREY,
    marginLeft: 4,
  },
  statLabel: {
    fontSize: 16,
    color: MEDIUM_GREY,
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressBarContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressBarBackground: {
    flex: 1,
    height: 12,
    backgroundColor: '#E0E0E0',
    borderRadius: 6,
    overflow: 'hidden',
    marginRight: 12,
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: DARK_GREY,
    borderRadius: 6,
  },
  progressText: {
    fontSize: 16,
    fontWeight: '600',
    color: DARK_GREY,
    minWidth: 50,
    textAlign: 'right',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_GREY,
    flex: 1,
  },
  filterButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: LIGHT_GREY,
  },
  emptyText: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textAlign: 'center',
    paddingVertical: 20,
  },
  areaCard: {
    backgroundColor: LIGHT_GREY,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  areaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  areaName: {
    fontSize: 18,
    fontWeight: '600',
    color: DARK_GREY,
    flex: 1,
  },
  areaCount: {
    fontSize: 16,
    fontWeight: '600',
    color: ACCENT_GREY,
  },
  areaProgressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  areaProgressBarBackground: {
    flex: 1,
    height: 8,
    backgroundColor: '#E0E0E0',
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 8,
  },
  areaProgressBarFill: {
    height: '100%',
    backgroundColor: DARK_GREY,
    borderRadius: 4,
  },
  areaPercentage: {
    fontSize: 14,
    fontWeight: '600',
    color: MEDIUM_GREY,
    minWidth: 45,
    textAlign: 'right',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 40,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GREY,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_GREY,
  },
  modalCloseButton: {
    padding: 4,
  },
  filterOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: LIGHT_GREY,
  },
  filterOptionSelected: {
    backgroundColor: LIGHT_GREY,
  },
  filterOptionText: {
    fontSize: 16,
    color: DARK_GREY,
  },
  filterOptionTextSelected: {
    fontWeight: '600',
  },
});