import React, { createContext } from 'react';

export const LoadingContext = createContext({ 
  isLocationLoaded: false, 
  setIsLocationLoaded: () => {} 
});

