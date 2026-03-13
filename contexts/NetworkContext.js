import React, { createContext, useContext } from 'react';
import * as Network from 'expo-network';

export const NetworkContext = createContext({
	isConnected: true,
	networkState: null,
});

export const NetworkProvider = ({ children }) => {
	const state = Network.useNetworkState();

	const isConnected =
		state && typeof state.isConnected === 'boolean'
			? state.isConnected && (state.isInternetReachable ?? true)
			: true;

	return (
		<NetworkContext.Provider value={{ isConnected, networkState: state }}>
			{children}
		</NetworkContext.Provider>
	);
};

export const useNetworkStatus = () => useContext(NetworkContext);

