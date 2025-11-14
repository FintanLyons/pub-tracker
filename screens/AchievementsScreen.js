import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, InteractionManager } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchLondonPubs } from '../services/PubService';
import { getCachedProfileStats } from '../services/ProfileStatsCache';
import PintGlassIcon from '../components/PintGlassIcon';
import { getLevelProgress } from '../utils/levelSystem';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const ACCENT_GREY = '#424242';
const AMBER = '#D4A017';
const BURGUNDY = '#A1183C';
const SAPPHIRE = '#2F4AA1';

export default function AchievementsScreen() {
  // Initialize with cached data for instant display
  const initialCachedStats = getCachedProfileStats();
  const initialPubs = initialCachedStats?.pubs || [];
  
  const [pubs, setPubs] = useState(initialPubs);
  const [currentScore, setCurrentScore] = useState(0);
  const [trophies, setTrophies] = useState([]);
  
  // Calculate score and trophies from pubs data
  const calculateScoreAndTrophies = useCallback((allPubs) => {
    if (!Array.isArray(allPubs) || allPubs.length === 0) {
      setCurrentScore(0);
      setTrophies([]);
      return;
    }

    // Calculate points from visited pubs
    const visitedPubs = allPubs.filter(p => p.isVisited);
    const pointsFromPubs = visitedPubs.reduce((sum, pub) => sum + (pub.points || 0), 0);

    // Calculate area & borough completion bonuses
    const areaMap = {};
    const boroughMap = {};
    allPubs.forEach(pub => {
      const area = pub.area || 'Unknown';
      if (!areaMap[area]) {
        areaMap[area] = { total: 0, visited: 0 };
      }
      areaMap[area].total++;
      if (pub.isVisited) {
        areaMap[area].visited++;
      }

      const borough =
        typeof pub.borough === 'string' && pub.borough.trim().length > 0
          ? pub.borough.trim()
          : 'Unknown';
      if (!boroughMap[borough]) {
        boroughMap[borough] = {
          total: 0,
          visited: 0,
          areas: new Set(),
        };
      }
      boroughMap[borough].total++;
      if (pub.isVisited) {
        boroughMap[borough].visited++;
      }
      if (area && area !== 'Unknown') {
        boroughMap[borough].areas.add(area);
      }
    });

    // Count completed areas (100% completion)
    const completedAreas = Object.entries(areaMap)
      .filter(([_, counts]) => counts.visited === counts.total && counts.total > 0)
      .map(([area, _]) => area);
    const areaBonusPoints = completedAreas.length * 50;

    const completedBoroughs = Object.entries(boroughMap)
      .filter(([_, counts]) => counts.visited === counts.total && counts.total > 0);
    const boroughBonusPoints = completedBoroughs.length * 200;

    // Current score = visited pub points + area bonuses
    const currentTotalScore = pointsFromPubs + areaBonusPoints + boroughBonusPoints;

    setCurrentScore(currentTotalScore);

    // Generate trophies
    const trophyList = [];

    // Add one trophy for each area (both completed and uncompleted)
    Object.entries(areaMap).forEach(([area, counts]) => {
      const percentage = counts.total > 0 ? Math.round((counts.visited / counts.total) * 100) : 0;
      const isCompleted = counts.visited === counts.total && counts.total > 0;

      trophyList.push({
        id: `area-${area}`,
        type: 'area',
        title: `${area} Complete`,
        description: `${percentage}%`,
        isAchieved: isCompleted,
        area: area,
      });
    });

    // Add borough trophies
    Object.entries(boroughMap).forEach(([borough, counts]) => {
      if (borough === 'Unknown') {
        return;
      }
      const percentage = counts.total > 0 ? Math.round((counts.visited / counts.total) * 100) : 0;
      const isCompleted = counts.visited === counts.total && counts.total > 0;

      trophyList.push({
        id: `borough-${borough}`,
        type: 'borough',
        title: `${borough} Champion`,
        description: `${percentage}%`,
        isAchieved: isCompleted,
        borough,
        completionPercentage: percentage,
      });
    });

    // Add one trophy for each pub achievement (only if the pub is visited)
    allPubs.forEach(pub => {
      if (pub.isVisited && pub.achievements && pub.achievements.length > 0) {
        pub.achievements.forEach((achievement, index) => {
          trophyList.push({
            id: `achievement-${pub.id}-${index}`,
            type: 'achievement',
            title: achievement,
            description: pub.name,
            isAchieved: true,
            pub: pub.name,
            achievement: achievement,
          });
        });
      }
    });

    // Add placeholder trophies for unvisited pub achievements
    allPubs.forEach(pub => {
      if (!pub.isVisited && pub.achievements && pub.achievements.length > 0) {
        pub.achievements.forEach((achievement, index) => {
          // Check if we already have a trophy for this achievement
          if (!trophyList.find(t => 
            t.type === 'achievement' && 
            t.pub === pub.name && 
            t.achievement === achievement
          )) {
            trophyList.push({
              id: `achievement-${pub.id}-${index}`,
              type: 'achievement',
              title: achievement,
              description: pub.name,
              isAchieved: false,
              pub: pub.name,
              achievement: achievement,
            });
          }
        });
      }
    });

    // Sort trophies so achieved ones appear first
    trophyList.sort((a, b) => {
      if (a.isAchieved && !b.isAchieved) return -1;
      if (!a.isAchieved && b.isAchieved) return 1;
      return 0; // Keep original order for trophies with same achievement status
    });

    setTrophies(trophyList);
  }, []);

  const loadAchievements = useCallback(async () => {
    // Always fetch fresh pubs to get latest visited status from AsyncStorage
    // This ensures that visiting a pub is immediately reflected when switching to AchievementsScreen
    let allPubs = [];
    try {
      allPubs = await fetchLondonPubs();
    } catch (error) {
      console.error('Error fetching pubs in AchievementsScreen:', error);
      // Fallback to cached data if fetch fails
      const cachedStats = getCachedProfileStats();
      allPubs = cachedStats?.pubs || [];
    }
    
    setPubs(allPubs);
    calculateScoreAndTrophies(allPubs);
  }, [calculateScoreAndTrophies]);

  // Calculate initial data from cached pubs on mount
  useEffect(() => {
    if (initialPubs.length > 0) {
      calculateScoreAndTrophies(initialPubs);
    }
  }, []); // Only run on mount

  useFocusEffect(
    useCallback(() => {
      // Show cached data immediately for instant display
      const cached = getCachedProfileStats();
      if (cached?.pubs && Array.isArray(cached.pubs) && cached.pubs.length > 0) {
        calculateScoreAndTrophies(cached.pubs);
      }

      // Refresh in background (non-blocking)
      InteractionManager.runAfterInteractions(() => {
        loadAchievements();
      });
    }, [loadAchievements, calculateScoreAndTrophies])
  );

  // Calculate level progress
  const levelProgress = getLevelProgress(currentScore);

  // Group trophies into rows of 3
  const trophyRows = [];
  for (let i = 0; i < trophies.length; i += 3) {
    trophyRows.push(trophies.slice(i, i + 3));
  }

  const getTrophyIcon = (trophy) => {
    switch (trophy.type) {
      case 'borough':
        return trophy.isAchieved ? 'crown' : 'crown-outline';
      case 'achievement':
        return trophy.isAchieved ? 'medal' : 'medal-outline';
      case 'area':
      default:
        return trophy.isAchieved ? 'trophy' : 'trophy-outline';
    }
  };

  const getTrophyColor = (trophy) => {
    if (!trophy.isAchieved) {
      return MEDIUM_GREY;
    }
    switch (trophy.type) {
      case 'borough':
        return BURGUNDY;
      case 'achievement':
        return SAPPHIRE;
      case 'area':
      default:
        return AMBER;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <PintGlassIcon size={48} color={DARK_GREY} />
        <Text style={styles.title}>Achievements</Text>
      </View>

      <View style={styles.statsCard}>
        <Text style={styles.levelLabel}>Level {levelProgress.level}</Text>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View 
              style={[styles.progressBarFill, { width: `${levelProgress.progressPercentage}%` }]} 
            />
          </View>
        </View>
        
        <Text style={styles.scoreText}>Total Score: {currentScore}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Trophy Collection</Text>
        {trophyRows.length === 0 ? (
          <Text style={styles.emptyText}>No trophies available</Text>
        ) : (
          trophyRows.map((row, rowIndex) => (
            <View key={rowIndex} style={styles.trophyRow}>
              {row.map((trophy) => (
                <View key={trophy.id} style={styles.trophyContainer}>
                  <View style={[
                    styles.trophyIconContainer,
                    !trophy.isAchieved && styles.trophyIconContainerLocked
                  ]}>
                    <MaterialCommunityIcons
                      name={getTrophyIcon(trophy)}
                      size={48}
                      color={getTrophyColor(trophy)}
                    />
                  </View>
                  <Text 
                    style={[
                      styles.trophyTitle,
                      !trophy.isAchieved && styles.trophyTitleLocked
                    ]}
                    numberOfLines={2}
                  >
                    {trophy.title}
                  </Text>
                  <Text 
                    style={[
                      styles.trophyDescription,
                      !trophy.isAchieved && styles.trophyDescriptionLocked
                    ]}
                    numberOfLines={1}
                  >
                    {trophy.description}
                  </Text>
                </View>
              ))}
              {/* Fill empty spaces in the last row to maintain grid layout */}
              {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, idx) => (
                <View key={`empty-${idx}`} style={styles.trophyContainer} />
              ))}
            </View>
          ))
        )}
      </View>
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
  header: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginTop: 12,
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
  levelLabel: {
    fontSize: 18,
    color: MEDIUM_GREY,
    marginBottom: 20,
    textTransform: 'uppercase',
    letterSpacing: 1,
    textAlign: 'center',
  },
  progressBarContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  scoreText: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textAlign: 'center',
  },
  progressBarBackground: {
    flex: 1,
    height: 12,
    backgroundColor: '#E0E0E0',
    borderRadius: 6,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: AMBER,
    borderRadius: 6,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: DARK_GREY,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 14,
    color: MEDIUM_GREY,
    textAlign: 'center',
    paddingVertical: 20,
  },
  trophyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  trophyContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
    minWidth: 100,
  },
  trophyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: LIGHT_GREY,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  trophyIconContainerLocked: {
    backgroundColor: '#F0F0F0',
    opacity: 0.5,
  },
  trophyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: DARK_GREY,
    textAlign: 'center',
    marginBottom: 4,
  },
  trophyTitleLocked: {
    color: MEDIUM_GREY,
    opacity: 0.6,
  },
  trophyDescription: {
    fontSize: 11,
    color: ACCENT_GREY,
    textAlign: 'center',
  },
  trophyDescriptionLocked: {
    color: MEDIUM_GREY,
    opacity: 0.5,
  },
});

