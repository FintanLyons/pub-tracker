import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
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
		return () => {
			cancelled = true;
			subscription.remove();
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

