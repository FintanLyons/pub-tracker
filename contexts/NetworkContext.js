import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import * as Network from 'expo-network';

export const NetworkContext = createContext({
	isConnected: true,
	networkState: null,
	refreshNetworkState: async () => {},
});

export const NetworkProvider = ({ children }) => {
	const [networkState, setNetworkState] = useState({});

	const refreshNetworkState = useCallback(async () => {
		const next = await Network.getNetworkStateAsync();
		setNetworkState(next);
		return next;
	}, []);

	useEffect(() => {
		let cancelled = false;
		Network.getNetworkStateAsync().then((next) => {
			if (!cancelled) setNetworkState(next);
		});
		const subscription = Network.addNetworkStateListener((next) => {
			setNetworkState(next);
		});
		// A change made while the app was in the background (e.g. airplane mode from
		// Control Centre or Settings) may never reach the listener — re-read on return.
		const appStateSub = AppState.addEventListener('change', (state) => {
			if (state !== 'active') return;
			Network.getNetworkStateAsync()
				.then((next) => {
					if (!cancelled) setNetworkState(next);
				})
				.catch(() => {});
		});
		return () => {
			cancelled = true;
			subscription.remove();
			appStateSub.remove();
		};
	}, []);

	const isConnected =
		networkState && typeof networkState.isConnected === 'boolean'
			? networkState.isConnected && (networkState.isInternetReachable ?? true)
			: true;

	return (
		<NetworkContext.Provider
			value={{ isConnected, networkState, refreshNetworkState }}
		>
			{children}
		</NetworkContext.Provider>
	);
};

export const useNetworkStatus = () => useContext(NetworkContext);

