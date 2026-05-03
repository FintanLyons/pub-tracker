import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Linking,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import { formatDistrictWithCode } from '../utils/postcodeDistrictDisplayNames';
import { useAuth } from '../contexts/AuthContext';
import {
  getDrinkCount,
  upsertDrinkCount,
  getReviews,
  getUserReview,
  upsertReview,
  deleteReview,
} from '../services/ReviewService';
import { PUB_FEATURES_DISPLAY, hasPubFeature } from '../constants/pubFeatures';

const openDirections = async (lat, lon) => {
  const destination = `${lat},${lon}`;
  const googleWebUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`;
  const appleMapsNativeUrl = `maps://?daddr=${destination}&dirflg=d`;
  const appleMapsWebUrl = `https://maps.apple.com/?daddr=${destination}&dirflg=d`;

  try {
    if (Platform.OS === 'ios') {
      // Always prefer Apple Maps on iOS to avoid Google web fallback.
      await Linking.openURL(appleMapsNativeUrl);
      return;
    }

    await Linking.openURL(googleWebUrl);
  } catch {
    if (Platform.OS === 'ios') {
      // Keep iOS on Apple Maps even if maps:// fails.
      Linking.openURL(appleMapsWebUrl).catch(() => {});
      return;
    }
    // Last-resort fallback for non-iOS.
    Linking.openURL(googleWebUrl).catch(() => {});
  }
};

const openPhone = (phone) => {
  Linking.openURL(`tel:${phone}`);
};

const openWebsite = (url) => {
  const prefixed = url.startsWith('http') ? url : `https://${url}`;
  Linking.openURL(prefixed);
};

const formatRelativeDate = (isoString) => {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
};

// Star row — read-only or interactive
function StarRow({ rating, size = 18, onSelect, style }) {
  return (
    <View style={[starRowStyles.row, style]}>
      {[1, 2, 3, 4, 5].map(n => (
        <TouchableOpacity
          key={n}
          onPress={onSelect ? () => onSelect(n) : undefined}
          disabled={!onSelect}
          activeOpacity={onSelect ? 0.7 : 1}
          hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
        >
          <MaterialCommunityIcons
            name={n <= rating ? 'star' : 'star-outline'}
            size={size}
            color={n <= rating ? COLORS.amber : COLORS.mediumGrey}
          />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const starRowStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 2 },
});

// ---------------------------------------------------------------------------

export default function PubCardContent({
  pub,
  isExpanded,
  getImageSource,
  pointerEvents,
  onScroll,
  scrollEnabled,
  scrollRef,
  onToggleVisited,
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // ── Opening status ─────────────────────────────────────────────────────────
  // TODO: replace closingHour with real pub.closing_time fetched from Google Places API
  const closingHour = 23; // 11 PM placeholder
  const now = new Date();
  const isOpen = now.getHours() < closingHour;

  // ── Area row segments ──────────────────────────────────────────────────────
  const areaSegments = [
    pub.area     ? formatDistrictWithCode(pub.area) : null,
    pub.ownership || null,
    pub.founded  ? `Est. ${pub.founded}` : null,
  ].filter(Boolean);

  // ── Drinks ─────────────────────────────────────────────────────────────────
  const [drinkCount, setDrinkCount] = useState(0);
  const [drinkCountLoading, setDrinkCountLoading] = useState(false);

  // ── Reviews ────────────────────────────────────────────────────────────────
  const [reviews, setReviews] = useState([]);
  const [reviewsLoading, setReviewsLoading] = useState(false);
  const [userReview, setUserReview] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [draftRating, setDraftRating] = useState(0);
  const [draftBody, setDraftBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Reset and re-fetch when the pub changes
  useEffect(() => {
    setDrinkCount(0);
    setReviews([]);
    setUserReview(null);
    setShowForm(false);
    setDraftRating(0);
    setDraftBody('');

    if (!pub?.id) return;

    // Drinks
    if (userId) {
      setDrinkCountLoading(true);
      getDrinkCount(userId, pub.id)
        .then(setDrinkCount)
        .catch(() => {})
        .finally(() => setDrinkCountLoading(false));
    }

    // Reviews
    setReviewsLoading(true);
    const fetchReviews = async () => {
      try {
        const [allReviews, mine] = await Promise.all([
          getReviews(pub.id),
          userId ? getUserReview(userId, pub.id) : Promise.resolve(null),
        ]);
        setReviews(allReviews);
        setUserReview(mine);
      } catch {
        // silently ignore fetch errors
      } finally {
        setReviewsLoading(false);
      }
    };
    fetchReviews();
  }, [pub?.id, userId]);

  // ── Drinks handlers ────────────────────────────────────────────────────────
  const handleChangeDrink = useCallback((delta) => {
    if (!userId) return;
    setDrinkCount(prev => {
      const next = Math.max(0, prev + delta);
      // Auto-mark as visited when the user logs their first drink
      if (delta > 0 && prev === 0 && !pub.isVisited && onToggleVisited) {
        onToggleVisited(pub.id);
      }
      upsertDrinkCount(userId, pub.id, next).catch(() => {
        setDrinkCount(prev); // rollback on error
      });
      return next;
    });
  }, [userId, pub?.id, pub?.isVisited, onToggleVisited]);

  // ── Review handlers ────────────────────────────────────────────────────────
  const openWriteForm = () => {
    if (userReview) {
      setDraftRating(userReview.rating);
      setDraftBody(userReview.body || '');
    } else {
      setDraftRating(0);
      setDraftBody('');
    }
    setShowForm(true);
  };

  const handleSubmitReview = useCallback(async () => {
    if (!userId || draftRating === 0) return;
    // Capture synchronously before any awaits so stale closures can't interfere
    const isNewReview = !userReview;
    const pubId = pub?.id;
    const wasVisited = pub?.isVisited;
    setSubmitting(true);
    try {
      await upsertReview(userId, pubId, draftRating, draftBody);
      const [allReviews, mine] = await Promise.all([
        getReviews(pubId),
        getUserReview(userId, pubId),
      ]);
      setReviews(allReviews);
      setUserReview(mine);
      setShowForm(false);
      if (isNewReview && !wasVisited && onToggleVisited) {
        onToggleVisited(pubId);
      }
    } catch {
      // silently ignore
    } finally {
      setSubmitting(false);
    }
  }, [userId, pub?.id, pub?.isVisited, userReview, draftRating, draftBody, onToggleVisited]);

  const handleDeleteReview = async () => {
    if (!userId) return;
    setSubmitting(true);
    try {
      await deleteReview(userId, pub.id);
      const allReviews = await getReviews(pub.id);
      setReviews(allReviews);
      setUserReview(null);
      setShowForm(false);
    } catch {
      // silently ignore
    } finally {
      setSubmitting(false);
    }
  };

  // ── Derived review stats ───────────────────────────────────────────────────
  const reviewCount = reviews.length;
  const avgRating = reviewCount > 0
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount).toFixed(1)
    : null;

  const hasPhone   = !!pub.phone;
  const hasWebsite = !!pub.website;

  return (
    <ScrollView
      style={styles.cardContent}
      contentContainerStyle={[
        styles.contentContainer,
        isExpanded && styles.contentContainerExpanded,
      ]}
      showsVerticalScrollIndicator={false}
      scrollEnabled={scrollEnabled !== undefined ? scrollEnabled : isExpanded}
      pointerEvents={pointerEvents}
      onScroll={onScroll}
      scrollEventThrottle={16}
      bounces={false}
      directionalLockEnabled={true}
      nestedScrollEnabled={Platform.OS === 'android'}
      removeClippedSubviews={Platform.OS === 'android'}
      overScrollMode={Platform.OS === 'android' ? 'never' : undefined}
      ref={scrollRef}
    >
      {/* ── Name row ─────────────────────────────────────────────────────── */}
      <View style={styles.nameRow}>
        <Text style={styles.pubName} numberOfLines={2}>{pub.name}</Text>
        {/* TODO: replace with real closing_time from Google Places API */}
        <Text style={[styles.openStatus, isOpen ? styles.openStatusOpen : styles.openStatusClosed]}>
          {isOpen ? 'Open until 11 PM' : 'Closed'}
        </Text>
      </View>

      {/* ── Area row ─────────────────────────────────────────────────────── */}
      {areaSegments.length > 0 && (
        <View style={styles.areaRow}>
          {areaSegments.map((segment, index) => (
            <React.Fragment key={index}>
              {index > 0 && <Text style={styles.amberDot}> · </Text>}
              <Text style={styles.areaSegment}>{segment}</Text>
            </React.Fragment>
          ))}
        </View>
      )}

      {/* ── Photo ────────────────────────────────────────────────────────── */}
      {pub.photoUrl && (
        <View style={styles.photoContainer}>
          <Image
            source={getImageSource(pub.photoUrl)}
            style={styles.pubPhoto}
            resizeMode="cover"
          />
        </View>
      )}

      {/* ── Feature icons ────────────────────────────────────────────────── */}
      <View style={styles.featuresContainer}>
        {PUB_FEATURES_DISPLAY.map((feature, index) => {
          const isActive = hasPubFeature(pub.features, feature.name);
          return (
            <View key={index} style={styles.featureIconWrapper}>
              <MaterialCommunityIcons
                name={feature.icon}
                size={24}
                color={isActive ? COLORS.amber : COLORS.mediumGrey}
                style={[styles.featureIcon, !isActive && styles.featureIconInactive]}
              />
            </View>
          );
        })}
      </View>

      {/* ── Achievement ──────────────────────────────────────────────────── */}
      {pub.achievements && pub.achievements.length > 0 && (
        <View style={styles.achievementContainer}>
          <MaterialCommunityIcons name="trophy" size={16} color={COLORS.amber} />
          <Text style={styles.achievementText}>{pub.achievements[0]}</Text>
        </View>
      )}

      {/* ── Action buttons ───────────────────────────────────────────────── */}
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={styles.actionButton}
          onPress={() => {
            void openDirections(pub.lat, pub.lon);
          }}
          activeOpacity={0.7}
        >
          <MaterialCommunityIcons name="directions" size={20} color="#FFFFFF" />
          <Text style={styles.actionLabel}>Directions</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, !hasPhone && styles.actionButtonDisabled]}
          onPress={hasPhone ? () => openPhone(pub.phone) : undefined}
          activeOpacity={hasPhone ? 0.7 : 1}
        >
          <MaterialCommunityIcons name="phone" size={20} color={hasPhone ? '#FFFFFF' : COLORS.mediumGrey} />
          <Text style={[styles.actionLabel, !hasPhone && styles.actionLabelDisabled]}>Phone</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionButton, !hasWebsite && styles.actionButtonDisabled]}
          onPress={hasWebsite ? () => openWebsite(pub.website) : undefined}
          activeOpacity={hasWebsite ? 0.7 : 1}
        >
          <MaterialCommunityIcons name="web" size={20} color={hasWebsite ? '#FFFFFF' : COLORS.mediumGrey} />
          <Text style={[styles.actionLabel, !hasWebsite && styles.actionLabelDisabled]}>Website</Text>
        </TouchableOpacity>
      </View>

      {/* ── Divider ──────────────────────────────────────────────────────── */}
      <View style={styles.divider} />

      {/* ── Reviews ──────────────────────────────────────────────────────── */}
      <View style={styles.reviewsSection}>
        {/* Summary header + drinks counter on the same row */}
        <View style={styles.reviewsSummaryRow}>
          {/* Left half — ratings */}
          {/* Left half — ratings + write/edit review */}
          <View style={styles.reviewsSummaryLeft}>
            <View style={styles.ratingsLine}>
              <MaterialCommunityIcons name="star" size={18} color={COLORS.amber} />
              <Text style={styles.reviewsSummaryText}>
                {avgRating ? `${avgRating}  ·  ${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'}` : 'No reviews yet'}
              </Text>
            </View>

            {userId && (
              <TouchableOpacity
                style={[styles.writeReviewButton, showForm && styles.writeReviewButtonActive]}
                onPress={showForm ? () => setShowForm(false) : openWriteForm}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name={userReview ? 'pencil' : 'plus'}
                  size={16}
                  color={showForm ? '#FFFFFF' : COLORS.amber}
                />
                <Text style={[styles.writeReviewLabel, showForm && styles.writeReviewLabelActive]}>
                  {userReview ? 'Edit review' : 'Write a review'}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Right half — drinks counter */}
          {userId && (
            <View style={styles.drinksInlineRow}>
              <TouchableOpacity
                style={[
                  styles.drinkRectButton,
                  (drinkCount === 0 || drinkCountLoading) && styles.drinkRectButtonDisabled,
                ]}
                onPress={() => handleChangeDrink(-1)}
                disabled={drinkCount === 0 || drinkCountLoading}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons
                  name="minus"
                  size={26}
                  color={drinkCount === 0 ? COLORS.mediumGrey : '#FFFFFF'}
                />
              </TouchableOpacity>

              <View style={styles.drinkCenter}>
                <MaterialCommunityIcons name="beer" size={28} color={COLORS.amber} />
                {drinkCountLoading ? (
                  <ActivityIndicator size="small" color={COLORS.amber} />
                ) : (
                  <Text style={styles.drinkCountText}>{drinkCount}</Text>
                )}
              </View>

              <TouchableOpacity
                style={[styles.drinkRectButton, drinkCountLoading && styles.drinkRectButtonDisabled]}
                onPress={() => handleChangeDrink(1)}
                disabled={drinkCountLoading}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="plus" size={26} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* AI summary placeholder */}
        {reviewCount > 0 && (
          <View style={styles.aiSummaryBox}>
            {/* TODO: replace with real AI-generated summary using OpenAI or similar */}
            <Text style={styles.aiSummaryLabel}>AI Summary</Text>
            <Text style={styles.aiSummaryText}>AI-generated summary coming soon.</Text>
          </View>
        )}

        {/* Review form — full width, shown when editing/writing */}
        {userId && (
          <>
            {showForm && (
              <View style={styles.reviewForm}>
                <View style={styles.reviewFormHeader}>
                  <Text style={styles.reviewFormUsername}>
                    {user?.username || 'Your review'}
                  </Text>
                  <StarRow rating={draftRating} size={32} onSelect={setDraftRating} style={styles.reviewFormStars} />
                </View>
                <TextInput
                  style={styles.reviewInput}
                  placeholder="Share your thoughts (optional)"
                  placeholderTextColor={COLORS.mediumGrey}
                  value={draftBody}
                  onChangeText={setDraftBody}
                  multiline
                  maxLength={500}
                  returnKeyType="done"
                  blurOnSubmit
                />
                <View style={styles.reviewFormActions}>
                  <TouchableOpacity
                    style={[styles.reviewFormButton, styles.reviewFormCancel]}
                    onPress={() => setShowForm(false)}
                    disabled={submitting}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.reviewFormCancelText}>Cancel</Text>
                  </TouchableOpacity>

                  {userReview && (
                    <TouchableOpacity
                      style={[styles.reviewFormButton, styles.reviewFormDelete]}
                      onPress={handleDeleteReview}
                      disabled={submitting}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.reviewFormDeleteText}>Delete</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[
                      styles.reviewFormButton,
                      styles.reviewFormSubmit,
                      (draftRating === 0 || submitting) && styles.reviewFormSubmitDisabled,
                    ]}
                    onPress={handleSubmitReview}
                    disabled={draftRating === 0 || submitting}
                    activeOpacity={0.7}
                  >
                    {submitting
                      ? <ActivityIndicator size="small" color="#FFFFFF" />
                      : <Text style={styles.reviewFormSubmitText}>Submit</Text>
                    }
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        )}

        {/* Reviews list */}
        {reviewsLoading ? (
          <ActivityIndicator size="small" color={COLORS.amber} style={{ marginTop: 12 }} />
        ) : (
          reviews.map(review => (
            <View
              key={review.id}
              style={[
                styles.reviewItem,
                review.userId === userId && styles.reviewItemOwn,
              ]}
            >
              <View style={styles.reviewItemHeader}>
                <Text style={styles.reviewItemUsername}>{review.username}</Text>
                <Text style={styles.reviewItemDate}>{formatRelativeDate(review.createdAt)}</Text>
              </View>
              <StarRow rating={review.rating} size={14} />
              {review.body ? (
                <Text style={styles.reviewItemBody}>{review.body}</Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      {/* ── History ──────────────────────────────────────────────────────── */}
      {pub.history && (
        <View style={styles.historyContainer}>
          <View style={styles.divider} />
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
  contentContainer: {
    paddingTop: 55,
    paddingBottom: 32,
  },
  contentContainerExpanded: {
    paddingTop: 80,
  },

  // ── Name row ──────────────────────────────────────────────────────────────
  nameRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  pubName: {
    fontSize: 24,
    fontWeight: 'bold',
    color: COLORS.darkGrey,
    flex: 1,
    paddingRight: 8,
  },
  openStatus: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 6,
    flexShrink: 0,
  },
  openStatusOpen: {
    color: '#2E7D32', // dark green
  },
  openStatusClosed: {
    color: '#C62828', // dark red
  },

  // ── Area row ──────────────────────────────────────────────────────────────
  areaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  areaSegment: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  amberDot: {
    fontSize: 20,
    color: COLORS.amber,
    fontWeight: 'bold',
    lineHeight: 20,
  },

  // ── Photo ─────────────────────────────────────────────────────────────────
  photoContainer: {
    width: '100%',
    height: 200,
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.lightGrey,
  },
  pubPhoto: {
    width: '100%',
    height: '100%',
  },

  // ── Features ──────────────────────────────────────────────────────────────
  featuresContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: COLORS.lightGrey,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  featureIconWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 40,
    height: 32,
  },
  featureIcon: {},
  featureIconInactive: {
    opacity: 0.4,
  },

  // ── Achievement ───────────────────────────────────────────────────────────
  achievementContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  achievementText: {
    fontSize: 14,
    color: COLORS.amber,
    marginLeft: 8,
    fontWeight: '600',
  },

  // ── Action buttons (solid fill) ───────────────────────────────────────────
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    gap: 8,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: COLORS.amber,
    gap: 4,
  },
  actionButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
  actionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  actionLabelDisabled: {
    color: COLORS.mediumGrey,
  },

  // ── Divider ───────────────────────────────────────────────────────────────
  divider: {
    height: 1,
    backgroundColor: COLORS.lightGrey,
    marginVertical: 8,
  },

  // ── Drinks counter ────────────────────────────────────────────────────────
  drinkCountText: {
    fontSize: 26,
    fontWeight: '700',
    color: COLORS.darkGrey,
    minWidth: 28,
    textAlign: 'center',
  },

  // ── Reviews ───────────────────────────────────────────────────────────────
  reviewsSection: {
    // no extra padding — inherited from cardContainer's paddingHorizontal
  },
  reviewsSummaryRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 8,
    gap: 12,
  },
  reviewsSummaryLeft: {
    flex: 1,
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingVertical: 2,
    gap: 8,
  },
  ratingsLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reviewsSummaryText: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.darkGrey,
  },
  drinksInlineRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 6,
  },
  drinkRectButton: {
    width: 44,
    marginVertical: 4,
    backgroundColor: COLORS.amber,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drinkRectButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
  drinkCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  aiSummaryBox: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  aiSummaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.amber,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  aiSummaryText: {
    fontSize: 13,
    color: COLORS.mediumGrey,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  writeReviewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: COLORS.amber,
    alignSelf: 'stretch',
    backgroundColor: 'transparent',
    marginBottom: 12,
  },
  writeReviewLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.amber,
  },
  writeReviewButtonActive: {
    backgroundColor: COLORS.amber,
  },
  writeReviewLabelActive: {
    color: '#FFFFFF',
  },
  reviewForm: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  reviewFormHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  reviewFormUsername: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.darkGrey,
    flex: 1,
  },
  reviewFormStars: {
    flex: 2,
    justifyContent: 'space-around',
  },
  reviewInput: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 10,
    fontSize: 14,
    color: COLORS.darkGrey,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  reviewFormActions: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'flex-end',
  },
  reviewFormButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  reviewFormCancel: {
    borderWidth: 1,
    borderColor: COLORS.mediumGrey,
  },
  reviewFormCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  reviewFormDelete: {
    borderWidth: 1,
    borderColor: '#C62828',
  },
  reviewFormDeleteText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#C62828',
  },
  reviewFormSubmit: {
    backgroundColor: COLORS.amber,
    minWidth: 72,
    alignItems: 'center',
  },
  reviewFormSubmitDisabled: {
    opacity: 0.45,
  },
  reviewFormSubmitText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  reviewItem: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.lightGrey,
    gap: 4,
  },
  reviewItemOwn: {
    backgroundColor: '#FFFBF0',
    borderRadius: 8,
    paddingHorizontal: 10,
    marginBottom: 2,
  },
  reviewItemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  reviewItemUsername: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.darkGrey,
  },
  reviewItemDate: {
    fontSize: 12,
    color: COLORS.mediumGrey,
  },
  reviewItemBody: {
    fontSize: 13,
    color: COLORS.darkGrey,
    lineHeight: 18,
    marginTop: 4,
  },

  // ── History ───────────────────────────────────────────────────────────────
  historyContainer: {
    marginBottom: 8,
  },
  history: {
    fontSize: 14,
    color: COLORS.darkGrey,
    lineHeight: 20,
    textAlign: 'justify',
  },
});
