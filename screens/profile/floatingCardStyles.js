import { StyleSheet } from 'react-native';
import { COLORS } from '../../constants/theme';

/** Card + button styles shared by the settings and delete-account pop-ups. */
const floatingCardStyles = StyleSheet.create({
  floatingModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  floatingCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.white,
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  floatingCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.divider,
  },
  floatingCardTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.darkGrey,
    textAlign: 'left',
    paddingRight: 8,
  },
  floatingCardClose: {
    padding: 6,
    marginRight: -2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingCardBody: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 20,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '400',
    color: COLORS.accentGrey,
    textAlign: 'left',
  },
  floatingCardActions: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: 22,
    paddingBottom: 22,
    gap: 12,
  },
  floatingActionBtn: {
    minHeight: 48,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  floatingActionBtnHalf: {
    flex: 1,
  },
  floatingActionBtnSecondary: {
    backgroundColor: COLORS.lightGrey,
  },
  floatingActionBtnTextSecondary: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.darkGrey,
    textAlign: 'center',
  },
});

export default floatingCardStyles;
