import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  Alert,
  StyleSheet,
  Linking,
  ActivityIndicator,
  Platform,
  Dimensions,
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
import { getOpeningStatus } from '../utils/openingHours';
import PubReviewsModal from './PubReviewsModal';
import PubSummonTroopsModal from './PubSummonTroopsModal';

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

/** Horizontal gallery must win over the card's vertical scroll. */
const GALLERY_LOCK_MIN_DX = 14;
const GALLERY_LOCK_AXIS_RATIO = 1.85;

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
  onBlockingOverlayVisibleChange,
}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  // ── Opening status (OSM opening_hours; empty → until 11 PM daily) ───────────
  const { isOpen, statusText: openStatusText } = getOpeningStatus(pub?.opening_hours);

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
  const [showReviewsModal, setShowReviewsModal] = useState(false);
  const [showSummonModal, setShowSummonModal] = useState(false);

  const [galleryWidth, setGalleryWidth] = useState(Dimensions.get('window').width);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [galleryScrollLock, setGalleryScrollLock] = useState(false);
  const galleryRef = useRef(null);
  const galleryTouchStart = useRef({ x: 0, y: 0 });

  // Reset and re-fetch when the pub changes
  useEffect(() => {
    setDrinkCount(0);
    setReviews([]);
    setUserReview(null);
    setShowReviewsModal(false);
    setShowSummonModal(false);
    setPhotoIndex(0);
    setGalleryScrollLock(false);
    galleryRef.current?.scrollTo({ x: 0, animated: false });

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

  const blockingOverlayOpen = showReviewsModal || showSummonModal;

  useEffect(() => {
    onBlockingOverlayVisibleChange?.(blockingOverlayOpen);
    return () => onBlockingOverlayVisibleChange?.(false);
  }, [blockingOverlayOpen, onBlockingOverlayVisibleChange]);

  const pubAreaLabel = pub?.area ? formatDistrictWithCode(pub.area) : null;

  const handleOpenSummonModal = useCallback(() => {
    if (!userId) {
      Alert.alert('Sign in required', 'Sign in to summon friends to this pub.');
      return;
    }
    setShowSummonModal(true);
  }, [userId]);

  // ── Drinks handlers ────────────────────────────────────────────────────────
  const handleChangeDrink = useCallback((delta) => {
    if (!userId) return;
    let shouldMarkVisited = false;
    setDrinkCount((prev) => {
      const next = Math.max(0, prev + delta);
      shouldMarkVisited = delta > 0 && prev === 0 && !pub.isVisited;
      upsertDrinkCount(userId, pub.id, next).catch(() => {
        setDrinkCount(prev);
      });
      return next;
    });
    // Never call onToggleVisited inside the setDrinkCount updater — that updates MapScreen
    // during PubCardContent's state flush ("Cannot update MapScreen while rendering").
    if (shouldMarkVisited && onToggleVisited) {
      queueMicrotask(() => onToggleVisited(pub.id));
    }
  }, [userId, pub?.id, pub?.isVisited, onToggleVisited]);

  // ── Review handlers ────────────────────────────────────────────────────────
  const handleSubmitReview = useCallback(async (rating, body) => {
    if (!userId || rating === 0) return;
    const isNewReview = !userReview;
    const pubId = pub?.id;
    const wasVisited = pub?.isVisited;
    try {
      await upsertReview(userId, pubId, rating, body);
      const [allReviews, mine] = await Promise.all([
        getReviews(pubId),
        getUserReview(userId, pubId),
      ]);
      setReviews(allReviews);
      setUserReview(mine);
      if (isNewReview && !wasVisited && onToggleVisited) {
        onToggleVisited(pubId);
      }
    } catch {
      // silently ignore
    }
  }, [userId, pub?.id, pub?.isVisited, userReview, onToggleVisited]);

  const handleDeleteReview = useCallback(async () => {
    if (!userId) return;
    try {
      await deleteReview(userId, pub.id);
      const allReviews = await getReviews(pub.id);
      setReviews(allReviews);
      setUserReview(null);
    } catch {
      // silently ignore
    }
  }, [userId, pub?.id]);

  // ── Derived review stats ───────────────────────────────────────────────────
  const reviewCount = reviews.length;
  const avgRatingNumeric = reviewCount > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviewCount
    : null;
  const avgRatingDisplay = avgRatingNumeric != null ? avgRatingNumeric.toFixed(1) : null;

  const hasPhone   = !!pub.phone;
  const hasWebsite = !!pub.website;

  const photoUrls = pub.photoUrls?.length ? pub.photoUrls : pub.photoUrl ? [pub.photoUrl] : [];
  const photoCount = photoUrls.length;
  const hasMultiplePhotos = photoCount > 1;

  const goToPhoto = useCallback(
    (index) => {
      const next = Math.max(0, Math.min(index, photoCount - 1));
      setPhotoIndex(next);
      galleryRef.current?.scrollTo({ x: next * galleryWidth, animated: true });
    },
    [galleryWidth, photoCount],
  );

  const handleGalleryScroll = useCallback(
    (e) => {
      if (galleryWidth <= 0) return;
      const idx = Math.round(e.nativeEvent.contentOffset.x / galleryWidth);
      if (idx !== photoIndex) setPhotoIndex(idx);
    },
    [galleryWidth, photoIndex],
  );

  const verticalScrollEnabled = blockingOverlayOpen
    ? false
    : galleryScrollLock
      ? false
      : (scrollEnabled !== undefined ? scrollEnabled : isExpanded);

  const contentPointerEvents = blockingOverlayOpen ? 'none' : pointerEvents;

  const handleGalleryTouchStart = useCallback((e) => {
    galleryTouchStart.current = {
      x: e.nativeEvent.pageX,
      y: e.nativeEvent.pageY,
    };
  }, []);

  const handleGalleryTouchMove = useCallback(
    (e) => {
      if (!hasMultiplePhotos) return;
      const dx = Math.abs(e.nativeEvent.pageX - galleryTouchStart.current.x);
      const dy = Math.abs(e.nativeEvent.pageY - galleryTouchStart.current.y);
      if (dx >= GALLERY_LOCK_MIN_DX && dx > dy * GALLERY_LOCK_AXIS_RATIO) {
        setGalleryScrollLock(true);
      }
    },
    [hasMultiplePhotos],
  );

  const handleGalleryTouchEnd = useCallback(() => {
    setGalleryScrollLock(false);
  }, []);

  return (
    <ScrollView
      style={styles.cardContent}
      contentContainerStyle={[
        styles.contentContainer,
        isExpanded && styles.contentContainerExpanded,
      ]}
      showsVerticalScrollIndicator={false}
      scrollEnabled={verticalScrollEnabled}
      pointerEvents={contentPointerEvents}
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
        <Text style={[styles.openStatus, isOpen ? styles.openStatusOpen : styles.openStatusClosed]}>
          {openStatusText}
        </Text>
      </View>

      {/* ── Area + rating (above photos) ─────────────────────────────────── */}
      <View style={styles.areaRatingRow}>
        <View style={styles.areaRowLeft}>
          {areaSegments.length > 0 ? (
            areaSegments.map((segment, index) => (
              <React.Fragment key={index}>
                {index > 0 && <Text style={styles.amberDot}> · </Text>}
                <Text style={styles.areaSegment}>{segment}</Text>
              </React.Fragment>
            ))
          ) : null}
        </View>
        <View style={styles.ratingSummaryRow}>
          {reviewCount > 0 ? (
            <>
              <View style={styles.ratingStat}>
                <Text style={styles.ratingStatValue}>{avgRatingDisplay}</Text>
                <MaterialCommunityIcons name="star" size={15} color={COLORS.amber} />
              </View>
              <Text style={styles.ratingStatSeparator}>·</Text>
              <View style={styles.ratingStat}>
                <Text style={styles.ratingStatValue}>{reviewCount}</Text>
                <MaterialCommunityIcons name="account-group-outline" size={15} color={COLORS.mediumGrey} />
              </View>
            </>
          ) : (
            <Text style={styles.noReviewsYetCompact}>No reviews</Text>
          )}
        </View>
      </View>

      {/* ── Photos (full-width pages; swipe or tap arrow for more) ───────── */}
      {photoCount > 0 && (
        <View
          style={styles.photoGalleryWrap}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) setGalleryWidth(w);
          }}
        >
          <ScrollView
            ref={galleryRef}
            horizontal
            pagingEnabled
            directionalLockEnabled
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            style={styles.photoGallery}
            onTouchStart={handleGalleryTouchStart}
            onTouchMove={handleGalleryTouchMove}
            onTouchEnd={handleGalleryTouchEnd}
            onTouchCancel={handleGalleryTouchEnd}
            onMomentumScrollEnd={handleGalleryScroll}
            onScrollEndDrag={handleGalleryScroll}
          >
            {photoUrls.map((url, i) => (
              <Image
                key={i}
                source={getImageSource(url)}
                style={[styles.galleryPhoto, { width: galleryWidth }]}
                resizeMode="cover"
              />
            ))}
          </ScrollView>

          {isExpanded && hasMultiplePhotos && photoIndex > 0 && (
            <TouchableOpacity
              style={[styles.photoGalleryArrow, styles.photoGalleryArrowLeft]}
              onPress={() => goToPhoto(photoIndex - 1)}
              activeOpacity={0.85}
              accessibilityLabel="Show previous photo"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="chevron-left" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          {isExpanded && hasMultiplePhotos && photoIndex < photoCount - 1 && (
            <TouchableOpacity
              style={[styles.photoGalleryArrow, styles.photoGalleryArrowRight]}
              onPress={() => goToPhoto(photoIndex + 1)}
              activeOpacity={0.85}
              accessibilityLabel="Show next photo"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="chevron-right" size={28} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          {hasMultiplePhotos && (
            <View style={styles.photoGalleryBadge} pointerEvents="none">
              <Text style={styles.photoGalleryBadgeText}>
                {photoIndex + 1} / {photoCount}
              </Text>
            </View>
          )}
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

      <View style={styles.dividerBeforeActions} />

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
      <View style={styles.dividerAfterActions} />

      {/* ── Reviews + drinks ─────────────────────────────────────────────── */}
      <View style={styles.reviewsSection}>
        <View style={styles.reviewsActionsRow}>
          <View style={styles.reviewsActionHalf}>
            <TouchableOpacity
              style={styles.reviewsButton}
              onPress={() => setShowReviewsModal(true)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Open reviews"
            >
              <MaterialCommunityIcons name="comment-text-outline" size={20} color={COLORS.amber} />
              <Text style={[styles.reviewsButtonLabel, styles.reviewsButtonLabelSpaced]} numberOfLines={1}>
                Reviews
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.summonRectButton, styles.reviewsRowSpaced]}
            onPress={handleOpenSummonModal}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Summon friends to this pub"
          >
            <MaterialCommunityIcons name="account-multiple" size={28} color="#FFFFFF" />
          </TouchableOpacity>

          {userId ? (
            <View style={[styles.drinksInlineRow, styles.reviewsRowSpaced]}>
              <TouchableOpacity
                style={[
                  styles.actionRectButton,
                  (drinkCount === 0 || drinkCountLoading) && styles.actionRectButtonDisabled,
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

              <View style={[styles.drinkCenter, styles.reviewsRowSpaced]}>
                <MaterialCommunityIcons name="beer" size={24} color={COLORS.amber} />
                {drinkCountLoading ? (
                  <ActivityIndicator size="small" color={COLORS.amber} />
                ) : (
                  <Text style={styles.drinkCountText}>{drinkCount}</Text>
                )}
              </View>

              <TouchableOpacity
                style={[
                  styles.actionRectButton,
                  styles.reviewsRowSpaced,
                  drinkCountLoading && styles.actionRectButtonDisabled,
                ]}
                onPress={() => handleChangeDrink(1)}
                disabled={drinkCountLoading}
                activeOpacity={0.7}
              >
                <MaterialCommunityIcons name="plus" size={26} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>

      <PubReviewsModal
        visible={showReviewsModal}
        onClose={() => setShowReviewsModal(false)}
        pubName={pub.name}
        reviews={reviews}
        reviewsLoading={reviewsLoading}
        userReview={userReview}
        userId={userId}
        avgRating={avgRatingNumeric}
        reviewCount={reviewCount}
        onSubmitReview={handleSubmitReview}
        onDeleteReview={handleDeleteReview}
      />

      <PubSummonTroopsModal
        visible={showSummonModal}
        onClose={() => setShowSummonModal(false)}
        pubId={pub.id}
        pubName={pub.name}
        pubAreaLabel={pubAreaLabel}
        currentUserId={userId}
      />

      {/* ── History / description ───────────────────────────────────────── */}
      {(pub.history || pub.description) && (
        <View style={styles.historyContainer}>
          <View style={styles.divider} />
          <Text style={styles.history}>{pub.history || pub.description}</Text>
        </View>
      )}
    </ScrollView>
  );
}

/** Same as featuresContainer: paddingVertical 10×2 + featureIconWrapper height 32 */
const REVIEWS_ACTIONS_ROW_HEIGHT = 52;
const REVIEWS_ROW_GAP = 8;
const SUMMON_BUTTON_MIN_WIDTH = 52;

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

  // ── Area + rating row (above photos) ─────────────────────────────────────
  areaRatingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 12,
  },
  areaRowLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    minWidth: 0,
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

  // ── Photos ────────────────────────────────────────────────────────────────
  photoGalleryWrap: {
    position: 'relative',
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: COLORS.lightGrey,
  },
  photoGallery: {
    width: '100%',
    borderRadius: 12,
  },
  galleryPhoto: {
    height: 200,
    backgroundColor: COLORS.lightGrey,
  },
  photoGalleryArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(28, 28, 28, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoGalleryArrowLeft: {
    left: 14,
  },
  photoGalleryArrowRight: {
    right: 14,
  },
  photoGalleryBadge: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(28, 28, 28, 0.55)',
  },
  photoGalleryBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },

  // ── Features ──────────────────────────────────────────────────────────────
  featuresContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: COLORS.lightGrey,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
      },
      android: {
        elevation: 0,
      },
      default: {},
    }),
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
    marginBottom: 8,
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
    marginBottom: 8,
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
  dividerBeforeActions: {
    height: 1,
    backgroundColor: COLORS.lightGrey,
    marginBottom: 8,
  },
  dividerAfterActions: {
    height: 1,
    backgroundColor: COLORS.lightGrey,
    marginBottom: 8,
  },

  // ── Drinks counter ────────────────────────────────────────────────────────
  drinkCountText: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.darkGrey,
    minWidth: 20,
    marginLeft: 4,
    textAlign: 'center',
  },

  // ── Reviews ───────────────────────────────────────────────────────────────
  reviewsSection: {
    width: '100%',
  },
  ratingSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  ratingStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingStatValue: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.darkGrey,
  },
  ratingStatSeparator: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.amber,
    lineHeight: 18,
  },
  noReviewsYetCompact: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  reviewsActionsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    width: '100%',
    height: REVIEWS_ACTIONS_ROW_HEIGHT,
  },
  reviewsRowSpaced: {
    marginLeft: REVIEWS_ROW_GAP,
  },
  reviewsActionHalf: {
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    minWidth: 108,
    height: REVIEWS_ACTIONS_ROW_HEIGHT,
    alignSelf: 'stretch',
  },
  reviewsButton: {
    flex: 1,
    height: REVIEWS_ACTIONS_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: COLORS.amber,
    backgroundColor: 'transparent',
  },
  reviewsButtonLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: COLORS.darkGrey,
  },
  reviewsButtonLabelSpaced: {
    marginLeft: 8,
  },
  drinksInlineRow: {
    flexGrow: 0,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  summonRectButton: {
    flex: 1,
    flexShrink: 1,
    minWidth: SUMMON_BUTTON_MIN_WIDTH,
    alignSelf: 'stretch',
    backgroundColor: COLORS.amber,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRectButton: {
    width: 44,
    alignSelf: 'stretch',
    backgroundColor: COLORS.amber,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionRectButtonDisabled: {
    backgroundColor: '#E0E0E0',
  },
  drinkCenter: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    maxWidth: 68,
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
