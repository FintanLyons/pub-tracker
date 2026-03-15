import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNetworkStatus } from '../contexts/NetworkContext';
import { COLORS } from '../constants/theme';

export default function OfflineOverlay() {
	const { isConnected } = useNetworkStatus();

	if (isConnected) return null;

	return (
		<View style={styles.overlay}>
			<View style={styles.card}>
				<MaterialCommunityIcons name="wifi-off" size={40} color={COLORS.amber} style={styles.icon} />
				<Text style={styles.title}>You&apos;re offline</Text>
				<Text style={styles.message}>
					Reconnect to keep tracking your pub adventures, favourites, and leaderboards.
				</Text>
				<TouchableOpacity
					onPress={() => {
						// NetworkProvider will update automatically when connectivity changes,
						// so this button is mainly a visual affordance.
					}}
					style={styles.button}
					activeOpacity={0.8}
				>
					<Text style={styles.buttonText}>Retry connection</Text>
				</TouchableOpacity>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	overlay: {
		position: 'absolute',
		top: 0,
		left: 0,
		right: 0,
		bottom: 0,
		backgroundColor: 'rgba(0, 0, 0, 0.6)',
		justifyContent: 'center',
		alignItems: 'center',
		zIndex: 100,
	},
	card: {
		marginHorizontal: 24,
		borderRadius: 16,
		paddingHorizontal: 24,
		paddingVertical: 28,
		backgroundColor: COLORS.charcoal,
		alignItems: 'center',
	},
	icon: {
		marginBottom: 12,
	},
	title: {
		fontSize: 20,
		fontWeight: '700',
		color: COLORS.amber,
		marginBottom: 8,
	},
	message: {
		fontSize: 14,
		textAlign: 'center',
		color: COLORS.lightGrey,
		marginBottom: 20,
	},
	button: {
		backgroundColor: COLORS.amber,
		borderRadius: 24,
		paddingHorizontal: 24,
		paddingVertical: 10,
	},
	buttonText: {
		color: COLORS.charcoal,
		fontSize: 15,
		fontWeight: '600',
	},
});

