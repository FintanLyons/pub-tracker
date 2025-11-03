import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { fetchLondonPubs } from '../services/PubService';
import PintGlassIcon from '../components/PintGlassIcon';

const DARK_GREY = '#2C2C2C';
const LIGHT_GREY = '#F5F5F5';
const MEDIUM_GREY = '#757575';
const ACCENT_GREY = '#424242';
const AMBER = '#D4A017';

export default function AchievementsScreen() {
  const [pubs, setPubs] = useState([]);
  const [currentScore, setCurrentScore] = useState(0);
  const [totalPossibleScore, setTotalPossibleScore] = useState(0);
  const [trophies, setTrophies] = useState([]);

  const loadAchievements = useCallback(async () => {
    const allPubs = await fetchLondonPubs();
    setPubs(allPubs);

    // Calculate points from visited pubs
    const visitedPubs = allPubs.filter(p => p.isVisited);
    const pointsFromPubs = visitedPubs.reduce((sum, pub) => sum + (pub.points || 0), 0);

    // Calculate area completion bonuses
    const areaMap = {};
    allPubs.forEach(pub => {
      const area = pub.area || 'Unknown';
      if (!areaMap[area]) {
        areaMap[area] = { total: 0, visited: 0 };
      }
      areaMap[area].total++;
      if (pub.isVisited) {
        areaMap[area].visited++;
      }
    });

    // Count completed areas (100% completion)
    const completedAreas = Object.entries(areaMap)
      .filter(([_, counts]) => counts.visited === counts.total && counts.total > 0)
      .map(([area, _]) => area);
    
    const areaBonusPoints = completedAreas.length * 50;

    // Calculate total possible points
    const totalPubPoints = allPubs.reduce((sum, pub) => sum + (pub.points || 0), 0);
    const totalAreaBonusPoints = Object.keys(areaMap).length * 50;
    const totalPossible = totalPubPoints + totalAreaBonusPoints;

    // Current score = visited pub points + area bonuses
    const currentTotalScore = pointsFromPubs + areaBonusPoints;

    setCurrentScore(currentTotalScore);
    setTotalPossibleScore(totalPossible);

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

  useFocusEffect(
    useCallback(() => {
      loadAchievements();
    }, [loadAchievements])
  );

  const scorePercentage = totalPossibleScore > 0 
    ? Math.round((currentScore / totalPossibleScore) * 100) 
    : 0;

  // Group trophies into rows of 3
  const trophyRows = [];
  for (let i = 0; i < trophies.length; i += 3) {
    trophyRows.push(trophies.slice(i, i + 3));
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <View style={styles.header}>
        <PintGlassIcon size={48} color={DARK_GREY} />
        <Text style={styles.title}>Achievements</Text>
      </View>

      <View style={styles.statsCard}>
        <View style={styles.mainStat}>
          <Text style={styles.scoreNumber}>{currentScore}</Text>
          <Text style={styles.totalNumber}>/ {totalPossibleScore}</Text>
        </View>
        <Text style={styles.statLabel}>Total Score</Text>
        
        <View style={styles.progressBarContainer}>
          <View style={styles.progressBarBackground}>
            <View 
              style={[styles.progressBarFill, { width: `${scorePercentage}%` }]} 
            />
          </View>
          <Text style={styles.progressText}>{scorePercentage}%</Text>
        </View>
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
                      name={trophy.isAchieved ? "trophy" : "trophy-outline"}
                      size={48}
                      color={trophy.isAchieved ? AMBER : MEDIUM_GREY}
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
  mainStat: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  scoreNumber: {
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
    backgroundColor: AMBER,
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

