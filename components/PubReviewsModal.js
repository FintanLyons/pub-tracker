import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS } from '../constants/theme';
import UserAvatar from './UserAvatar';

const CARD_MAX_HEIGHT = Math.min(Dimensions.get('window').height * 0.82, 640);
const CARD_HEADER_HEIGHT = 58;
const CARD_BODY_HEIGHT = CARD_MAX_HEIGHT - CARD_HEADER_HEIGHT;
const REVIEW_AVATAR_SIZE = 40;
const REVIEW_USERNAME_FONT_SIZE = 15;
const REVIEW_USERNAME_LINE_HEIGHT = 20;
const REVIEW_BODY_FONT_SIZE = 13;
const REVIEW_BODY_LINE_HEIGHT = 18;
const REVIEW_DATE_FONT_SIZE = 11;
const REVIEW_BODY_MAX_LINES = 4;
/** Very light amber tint for the signed-in user's review row */
const REVIEW_OWN_BG = '#FBF6E8';

const STAR_LEVELS = [5, 4, 3, 2, 1];

const formatRelativeTime = (isoString) => {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  if (diff < 0) return 'Just now';

  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(months / 12);
  if (years === 1) return '1 year ago';
  return `${years} years ago`;
};

/** Read-only stars with partial fill for averages (e.g. 4.3). */
function RatingStarsDisplay({ rating = 0, size = 22, style }) {
  const value = Math.min(5, Math.max(0, Number(rating) || 0));

  return (
    <View style={[styles.starsRow, style]}>
      {[1, 2, 3, 4, 5].map((star) => {
        const fill = Math.min(1, Math.max(0, value - (star - 1)));
        return (
          <View key={star} style={{ width: size, height: size }}>
            <MaterialCommunityIcons
              name="star-outline"
              size={size}
              color={COLORS.mediumGrey}
              style={styles.starUnderlay}
            />
            {fill > 0 && (
              <View style={[styles.starFillClip, { width: size * fill }]}>
                <MaterialCommunityIcons name="star" size={size} color={COLORS.amber} />
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** Interactive star picker. */
function StarRow({ rating, size = 28, onSelect, style }) {
  return (
    <View style={[styles.starsRow, style]}>
      {[1, 2, 3, 4, 5].map((n) => (
        <TouchableOpacity
          key={n}
          onPress={() => onSelect(n)}
          activeOpacity={0.7}
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

function RatingDistributionChart({ starCounts, maxCount }) {
  return (
    <View style={styles.distributionCol}>
      {STAR_LEVELS.map((star) => {
        const count = starCounts[star] || 0;
        const widthPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
        return (
          <View key={star} style={styles.distributionRow}>
            <Text style={styles.distributionStarLabel}>{star}</Text>
            <MaterialCommunityIcons name="star" size={11} color={COLORS.amber} />
            <View style={styles.distributionBarTrack}>
              <View
                style={[
                  styles.distributionBarFill,
                  { width: `${widthPct}%` },
                  count === 0 && styles.distributionBarEmpty,
                ]}
              />
            </View>
            <Text style={styles.distributionCount}>{count}</Text>
          </View>
        );
      })}
    </View>
  );
}

function ReviewForm({
  draftRating,
  draftBody,
  submitting,
  isEdit,
  onRatingChange,
  onBodyChange,
  onSubmit,
  onDelete,
  onCancel,
  style,
}) {
  return (
    <View style={[styles.writeSection, style]}>
      <StarRow
        rating={draftRating}
        size={28}
        onSelect={onRatingChange}
        style={styles.formStars}
      />
      <TextInput
        style={styles.reviewInput}
        placeholder="Write a comment (optional)"
        placeholderTextColor={COLORS.mediumGrey}
        value={draftBody}
        onChangeText={onBodyChange}
        multiline
        maxLength={500}
        returnKeyType="done"
        blurOnSubmit
      />
      <View style={styles.formActions}>
        <TouchableOpacity
          style={[styles.formButton, styles.formCancel]}
          onPress={onCancel}
          disabled={submitting}
          activeOpacity={0.7}
        >
          <Text style={styles.formCancelText}>Cancel</Text>
        </TouchableOpacity>
        {isEdit ? (
          <TouchableOpacity
            style={[styles.formButton, styles.formDelete]}
            onPress={onDelete}
            disabled={submitting}
            activeOpacity={0.7}
          >
            <Text style={styles.formDeleteText}>Delete</Text>
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          style={[
            styles.formButton,
            styles.formSubmit,
            (draftRating === 0 || submitting) && styles.formSubmitDisabled,
          ]}
          onPress={onSubmit}
          disabled={draftRating === 0 || submitting}
          activeOpacity={0.7}
        >
          {submitting ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <Text style={styles.formSubmitText}>
              {isEdit ? 'Update' : 'Post'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ReviewBodyTail({ label, onPress, fadeBackgroundColor, accessibilityLabel }) {
  return (
    <View style={[styles.reviewMoreTail, { backgroundColor: fadeBackgroundColor }]}>
      <TouchableOpacity
        style={styles.reviewMoreTailPress}
        onPress={onPress}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
      >
        <Text style={styles.reviewEllipsis}>... </Text>
        <Text style={styles.reviewMoreLink}>{label}</Text>
      </TouchableOpacity>
    </View>
  );
}

function ReviewBodyLastLineRow({ lineText, tailLabel, onTailPress, fadeBackgroundColor, accessibilityLabel }) {
  return (
    <View style={styles.reviewFourthLineRow}>
      <Text
        style={[styles.reviewItemBody, styles.reviewFourthLineText]}
        numberOfLines={1}
        ellipsizeMode="clip"
      >
        {lineText}
      </Text>
      <ReviewBodyTail
        label={tailLabel}
        onPress={onTailPress}
        fadeBackgroundColor={fadeBackgroundColor}
        accessibilityLabel={accessibilityLabel}
      />
    </View>
  );
}

function ReviewBodyText({ body, fadeBackgroundColor = '#FFFFFF' }) {
  const [expanded, setExpanded] = useState(false);
  const [measuredLines, setMeasuredLines] = useState(null);

  useEffect(() => {
    setExpanded(false);
    setMeasuredLines(null);
  }, [body]);

  const handleMeasureLayout = (event) => {
    const { lines } = event.nativeEvent;
    if (!lines?.length) return;
    setMeasuredLines((prev) => prev ?? lines);
  };

  const isTruncated = measuredLines != null && measuredLines.length > REVIEW_BODY_MAX_LINES;
  const showSplitTail = isTruncated && !expanded;

  const measureText = (
    <Text
      style={[styles.reviewItemBody, styles.reviewBodyMeasure]}
      onTextLayout={handleMeasureLayout}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {body}
    </Text>
  );

  if (expanded && isTruncated && measuredLines) {
    const headText = measuredLines
      .slice(0, -1)
      .map((line) => line.text)
      .join('');
    const lastLineText = measuredLines[measuredLines.length - 1]?.text ?? '';

    return (
      <View style={styles.reviewBodyWrap}>
        {measureText}
        {headText ? <Text style={styles.reviewItemBody}>{headText}</Text> : null}
        <ReviewBodyLastLineRow
          lineText={lastLineText}
          tailLabel="less"
          onTailPress={() => setExpanded(false)}
          fadeBackgroundColor={fadeBackgroundColor}
          accessibilityLabel="Show less of review"
        />
      </View>
    );
  }

  if (expanded) {
    return (
      <View style={styles.reviewBodyWrap}>
        {measureText}
        <Text style={styles.reviewItemBody}>{body}</Text>
      </View>
    );
  }

  if (showSplitTail) {
    const headText = measuredLines
      .slice(0, REVIEW_BODY_MAX_LINES - 1)
      .map((line) => line.text)
      .join('');
    const fourthLineText = measuredLines[REVIEW_BODY_MAX_LINES - 1]?.text ?? '';

    return (
      <View style={styles.reviewBodyWrap}>
        {measureText}
        {headText ? <Text style={styles.reviewItemBody}>{headText}</Text> : null}
        <ReviewBodyLastLineRow
          lineText={fourthLineText}
          tailLabel="more"
          onTailPress={() => setExpanded(true)}
          fadeBackgroundColor={fadeBackgroundColor}
          accessibilityLabel="Show full review"
        />
      </View>
    );
  }

  return (
    <View style={styles.reviewBodyWrap}>
      {measureText}
      <Text
        style={styles.reviewItemBody}
        numberOfLines={measuredLines == null ? REVIEW_BODY_MAX_LINES : undefined}
      >
        {body}
      </Text>
    </View>
  );
}

function ReviewListItem({
  review,
  isOwn,
  isEditing,
  onEditPress,
  onCancelEdit,
  formSlot,
  isLast,
}) {
  const editAction = isOwn && (onEditPress || onCancelEdit) ? (
    <TouchableOpacity
      style={styles.editIconButton}
      onPress={isEditing ? onCancelEdit : onEditPress}
      activeOpacity={0.7}
      accessibilityLabel={isEditing ? 'Cancel editing review' : 'Edit review'}
      accessibilityRole="button"
    >
      <MaterialCommunityIcons
        name={isEditing ? 'close' : 'pencil-outline'}
        size={16}
        color={COLORS.amber}
      />
    </TouchableOpacity>
  ) : null;

  return (
    <View
      style={[
        styles.reviewItem,
        isOwn && styles.reviewItemOwn,
        !isLast && styles.reviewItemBorder,
      ]}
    >
      <View style={styles.reviewHeaderRow}>
        <UserAvatar
          avatarUrl={review.avatarUrl}
          size={REVIEW_AVATAR_SIZE}
          iconSize={22}
          style={styles.reviewHeaderAvatar}
        />
        <View style={styles.reviewHeaderBorderCol}>
          <Text style={styles.reviewItemUsername} numberOfLines={1}>
            {review.username}
          </Text>
          {!isEditing && (
            <RatingStarsDisplay
              rating={review.rating}
              size={11}
              style={styles.reviewStarsCompact}
            />
          )}
        </View>
        {!isEditing && (
          <View style={styles.reviewHeaderActions}>
            {editAction}
            <Text style={styles.reviewItemAgo}>
              {formatRelativeTime(review.createdAt)}
            </Text>
          </View>
        )}
        {isEditing && editAction}
      </View>
      {!isEditing && review.body ? (
        <View style={styles.reviewBodySection}>
          <ReviewBodyText
            body={review.body}
            fadeBackgroundColor={isOwn ? REVIEW_OWN_BG : '#FFFFFF'}
          />
        </View>
      ) : null}
      {isEditing && formSlot ? (
        <View style={styles.reviewBodySection}>{formSlot}</View>
      ) : null}
    </View>
  );
}

export default function PubReviewsModal({
  visible,
  onClose,
  pubName,
  reviews = [],
  reviewsLoading = false,
  userReview = null,
  userId = null,
  avgRating = null,
  reviewCount = 0,
  onSubmitReview,
  onDeleteReview,
}) {
  const [draftRating, setDraftRating] = useState(0);
  const [draftBody, setDraftBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMode, setFormMode] = useState(null);

  useEffect(() => {
    if (!visible) {
      setFormMode(null);
      return;
    }
    setFormMode(null);
    if (userReview) {
      setDraftRating(userReview.rating || 0);
      setDraftBody(userReview.body || '');
    } else {
      setDraftRating(0);
      setDraftBody('');
    }
  }, [visible, userReview]);

  const closeForm = useCallback(() => {
    setFormMode(null);
    if (userReview) {
      setDraftRating(userReview.rating || 0);
      setDraftBody(userReview.body || '');
    } else {
      setDraftRating(0);
      setDraftBody('');
    }
  }, [userReview]);

  const openNewForm = useCallback(() => {
    setDraftRating(0);
    setDraftBody('');
    setFormMode('new');
  }, []);

  const openEditForm = useCallback(() => {
    if (userReview) {
      setDraftRating(userReview.rating || 0);
      setDraftBody(userReview.body || '');
    }
    setFormMode('edit');
  }, [userReview]);

  const starCounts = useMemo(() => {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    reviews.forEach((r) => {
      const star = Math.round(Number(r.rating));
      if (star >= 1 && star <= 5) counts[star] += 1;
    });
    return counts;
  }, [reviews]);

  const maxStarCount = useMemo(
    () => Math.max(1, ...STAR_LEVELS.map((s) => starCounts[s] || 0)),
    [starCounts],
  );

  const sortedReviews = useMemo(() => {
    const byRecent = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);
    const others = reviews
      .filter((r) => r.userId !== userId)
      .sort(byRecent);
    const mine = userId ? reviews.find((r) => r.userId === userId) : null;
    return mine ? [mine, ...others] : others;
  }, [reviews, userId]);

  const handleSubmit = async () => {
    if (!onSubmitReview || draftRating === 0) return;
    setSubmitting(true);
    try {
      await onSubmitReview(draftRating, draftBody);
      setFormMode(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!onDeleteReview) return;
    setSubmitting(true);
    try {
      await onDeleteReview();
      setDraftRating(0);
      setDraftBody('');
      setFormMode(null);
    } finally {
      setSubmitting(false);
    }
  };

  const reviewForm = (
    <ReviewForm
      draftRating={draftRating}
      draftBody={draftBody}
      submitting={submitting}
      isEdit={formMode === 'edit'}
      onRatingChange={setDraftRating}
      onBodyChange={setDraftBody}
      onSubmit={handleSubmit}
      onDelete={handleDelete}
      onCancel={closeForm}
    />
  );

  const numericAvg = avgRating != null ? Number(avgRating) : null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.overlayTouchable}
          activeOpacity={1}
          onPress={onClose}
          accessibilityLabel="Close reviews"
          accessibilityRole="button"
        />
        <View style={[styles.card, { height: CARD_MAX_HEIGHT }]}>
          <View style={styles.header}>
            <View style={styles.headerTextCol}>
              <Text style={styles.title}>Reviews</Text>
              {pubName ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {pubName}
                </Text>
              ) : null}
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={styles.closeButton}
              accessibilityLabel="Close reviews"
              accessibilityRole="button"
            >
              <MaterialCommunityIcons name="close" size={24} color={COLORS.darkGrey} />
            </TouchableOpacity>
          </View>

          <View style={[styles.body, { height: CARD_BODY_HEIGHT }]}>
            <View style={styles.summarySection}>
              <View style={styles.summaryScoreCol}>
                <Text style={styles.summaryScore}>
                  {numericAvg != null ? numericAvg.toFixed(1) : '—'}
                </Text>
                <RatingStarsDisplay rating={numericAvg ?? 0} size={18} />
                <Text style={styles.summaryCount}>
                  {reviewCount === 0
                    ? 'No reviews yet'
                    : `${reviewCount} ${reviewCount === 1 ? 'review' : 'reviews'}`}
                </Text>
              </View>
              <RatingDistributionChart starCounts={starCounts} maxCount={maxStarCount} />
            </View>

            <View style={styles.reviewsListHeader}>
              <Text style={styles.sectionHeading}>All reviews</Text>
              {!userId ? (
                <Text style={styles.signInHint}>Sign in to leave a review.</Text>
              ) : null}
              {userId && !userReview && formMode !== 'new' ? (
                <TouchableOpacity
                  style={styles.writeReviewPrompt}
                  onPress={openNewForm}
                  activeOpacity={0.7}
                >
                  <MaterialCommunityIcons name="pencil-plus-outline" size={18} color={COLORS.amber} />
                  <Text style={styles.writeReviewPromptText}>Write a review</Text>
                </TouchableOpacity>
              ) : null}
              {userId && !userReview && formMode === 'new' ? reviewForm : null}
            </View>

            <ScrollView
              style={styles.reviewsScroll}
              contentContainerStyle={styles.reviewsScrollContent}
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              nestedScrollEnabled
            >
              {reviewsLoading ? (
                <ActivityIndicator
                  size="small"
                  color={COLORS.amber}
                  style={styles.listLoader}
                />
              ) : sortedReviews.length === 0 ? (
                <Text style={styles.emptyReviews}>No reviews yet. Be the first!</Text>
              ) : (
                sortedReviews.map((review, index) => {
                  const isOwn = review.userId === userId;
                  const isEditing = isOwn && formMode === 'edit';
                  return (
                    <ReviewListItem
                      key={review.id}
                      review={review}
                      isOwn={isOwn}
                      isEditing={isEditing}
                      onEditPress={isOwn ? openEditForm : undefined}
                      onCancelEdit={isOwn ? closeForm : undefined}
                      formSlot={isEditing ? reviewForm : null}
                      isLast={index === sortedReviews.length - 1}
                    />
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 28,
  },
  overlayTouchable: {
    ...StyleSheet.absoluteFillObject,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
    elevation: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  headerTextCol: {
    flex: 1,
    paddingRight: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.darkGrey,
  },
  subtitle: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    marginTop: 2,
  },
  closeButton: {
    padding: 4,
  },
  body: {
    flex: 1,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  summarySection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.lightGrey,
  },
  summaryScoreCol: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 72,
    gap: 4,
  },
  summaryScore: {
    fontSize: 44,
    fontWeight: '700',
    color: COLORS.darkGrey,
    lineHeight: 48,
  },
  summaryCount: {
    fontSize: 12,
    color: COLORS.mediumGrey,
    textAlign: 'center',
  },
  distributionCol: {
    flex: 1,
    gap: 5,
  },
  distributionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  distributionStarLabel: {
    width: 10,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'right',
  },
  distributionBarTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.lightGrey,
    overflow: 'hidden',
  },
  distributionBarFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: COLORS.amber,
    minWidth: 0,
  },
  distributionBarEmpty: {
    backgroundColor: 'transparent',
  },
  distributionCount: {
    width: 22,
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.mediumGrey,
    textAlign: 'right',
  },
  reviewsListHeader: {
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.lightGrey,
  },
  reviewsScroll: {
    flex: 1,
    minHeight: 0,
  },
  reviewsScrollContent: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 20,
  },
  writeSection: {
    marginTop: 10,
    gap: 10,
  },
  writeReviewPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    marginTop: 8,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: COLORS.amber,
  },
  writeReviewPromptText: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.amber,
  },
  sectionHeading: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.darkGrey,
    marginBottom: 0,
  },
  formStars: {
    alignSelf: 'flex-start',
    gap: 4,
  },
  reviewInput: {
    backgroundColor: COLORS.lightGrey,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    padding: 10,
    fontSize: 14,
    color: COLORS.darkGrey,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    flexWrap: 'wrap',
  },
  formButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    minWidth: 72,
    alignItems: 'center',
  },
  formCancel: {
    borderWidth: 1,
    borderColor: COLORS.mediumGrey,
    marginRight: 'auto',
  },
  formCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.mediumGrey,
  },
  formDelete: {
    borderWidth: 1,
    borderColor: '#C62828',
  },
  formDeleteText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#C62828',
  },
  formSubmit: {
    backgroundColor: COLORS.amber,
  },
  formSubmitDisabled: {
    opacity: 0.45,
  },
  formSubmitText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  signInHint: {
    fontSize: 13,
    color: COLORS.mediumGrey,
    marginTop: 8,
    fontStyle: 'italic',
  },
  listLoader: {
    marginVertical: 16,
  },
  emptyReviews: {
    fontSize: 14,
    color: COLORS.mediumGrey,
    textAlign: 'center',
    paddingVertical: 16,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  starUnderlay: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  starFillClip: {
    position: 'absolute',
    left: 0,
    top: 0,
    overflow: 'hidden',
  },
  reviewItem: {
    paddingVertical: 14,
  },
  reviewItemOwn: {
    backgroundColor: REVIEW_OWN_BG,
    borderRadius: 10,
    paddingHorizontal: 10,
    marginHorizontal: -10,
  },
  reviewItemBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E5',
  },
  reviewHeaderRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    minHeight: REVIEW_AVATAR_SIZE,
  },
  reviewHeaderAvatar: {
    alignSelf: 'center',
  },
  reviewHeaderBorderCol: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
    gap: 2,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: '#E0E0E0',
    paddingLeft: 10,
  },
  reviewStarsCompact: {
    gap: 1,
  },
  reviewHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  editIconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: COLORS.amber,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    flexShrink: 0,
  },
  reviewItemUsername: {
    flex: 1,
    fontSize: REVIEW_USERNAME_FONT_SIZE,
    fontWeight: '700',
    color: COLORS.darkGrey,
    lineHeight: REVIEW_USERNAME_LINE_HEIGHT,
  },
  reviewItemAgo: {
    fontSize: REVIEW_DATE_FONT_SIZE,
    color: COLORS.mediumGrey,
    flexShrink: 0,
  },
  reviewBodySection: {
    marginTop: 8,
  },
  reviewItemBody: {
    fontSize: REVIEW_BODY_FONT_SIZE,
    lineHeight: REVIEW_BODY_LINE_HEIGHT,
    color: COLORS.darkGrey,
  },
  reviewBodyWrap: {
    position: 'relative',
  },
  reviewBodyMeasure: {
    position: 'absolute',
    opacity: 0,
    left: 0,
    right: 0,
    zIndex: -1,
    pointerEvents: 'none',
  },
  reviewFourthLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  reviewFourthLineText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 2,
  },
  reviewMoreTail: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexShrink: 0,
    paddingLeft: 4,
  },
  reviewMoreTailPress: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  reviewEllipsis: {
    fontSize: REVIEW_BODY_FONT_SIZE,
    lineHeight: REVIEW_BODY_LINE_HEIGHT,
    color: COLORS.darkGrey,
  },
  reviewMoreLink: {
    fontSize: REVIEW_BODY_FONT_SIZE,
    lineHeight: REVIEW_BODY_LINE_HEIGHT,
    fontWeight: '700',
    color: COLORS.amber,
  },
});
