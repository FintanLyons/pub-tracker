import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetworkStatus } from '../contexts/NetworkContext';
import { COLORS } from '../constants/theme';

/** Tab bar height (60) + gap — matches navigation/TabNavigator.js and ToastContext. */
export const OFFLINE_BANNER_TAB_BAR_CLEARANCE = 68;
/** Height the banner occupies, so toasts can sit above it. */
export const OFFLINE_BANNER_HEIGHT = 44;

/**
 * Slim "You're offline" strip at the bottom of the screen. Unlike the old full-screen
 * overlay it doesn't block the app — already-loaded pubs and stats stay usable.
 * @param {{ aboveTabBar?: boolean }} props — true on the tab screens (clears the tab bar).
 */
export default function OfflineBanner({ aboveTabBar = false }) {
	const insets = useSafeAreaInsets();
	const { isConnected, refreshNetworkState } = useNetworkStatus();
	const [rechecking, setRechecking] = useState(false);

	if (isConnected) return null;

	const handleRetry = async () => {
		setRechecking(true);
		try {
			await refreshNetworkState();
		} catch {
			// Still offline; the banner stays until the network listener reports a connection.
		} finally {
			setRechecking(false);
		}
	};

	const bottom = aboveTabBar
		? OFFLINE_BANNER_TAB_BAR_CLEARANCE + insets.bottom
		: Math.max(insets.bottom, 12);

	return (
		<View style={[styles.wrapper, { bottom }]} pointerEvents="box-none">
			<View
				style={styles.banner}
				accessibilityRole="alert"
				accessibilityLiveRegion="polite"
			>
				<MaterialCommunityIcons name="wifi-off" size={18} color={COLORS.amber} />
				<Text style={styles.text} numberOfLines={2}>
					You&apos;re offline — showing what&apos;s already loaded.
				</Text>
				<TouchableOpacity
					onPress={handleRetry}
					disabled={rechecking}
					style={styles.retry}
					accessibilityRole="button"
					accessibilityLabel="Retry connection"
				>
					{rechecking ? (
						<ActivityIndicator size="small" color={COLORS.amber} />
					) : (
						<Text style={styles.retryText}>Retry</Text>
					)}
				</TouchableOpacity>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	wrapper: {
		position: 'absolute',
		left: 12,
		right: 12,
		zIndex: 1500,
		elevation: 12,
	},
	banner: {
		minHeight: OFFLINE_BANNER_HEIGHT - 4,
		flexDirection: 'row',
		alignItems: 'center',
		gap: 10,
		paddingHorizontal: 14,
		paddingVertical: 8,
		borderRadius: 12,
		backgroundColor: COLORS.charcoal,
	},
	text: {
		flex: 1,
		fontSize: 13,
		color: COLORS.lightGrey,
	},
	retry: {
		paddingVertical: 4,
		paddingHorizontal: 8,
		minWidth: 48,
		alignItems: 'center',
	},
	retryText: {
		color: COLORS.amber,
		fontWeight: '700',
		fontSize: 14,
	},
});
