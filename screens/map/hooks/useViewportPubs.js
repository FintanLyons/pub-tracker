import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchLondonPubs } from '../../../services/PubService';
import { useNetworkStatus } from '../../../contexts/NetworkContext';
import { useToast } from '../../../contexts/ToastContext';
import {
  approximateBoundsFromCenter,
  boundsContain,
  expandBounds,
  mergeBounds,
  MIN_PUB_FETCH_ZOOM,
  parseVisibleBounds,
} from '../mapUtils';

const LOAD_FAILED_MESSAGE = "Couldn't load pubs — retrying when you're back online.";
/** Retry a failed area load after this long (also retried on the next pan / reconnect). */
const RETRY_DELAY_MS = 8000;
/** Don't repeat the failure message more often than this. */
const FAILURE_TOAST_INTERVAL_MS = 30000;

export function useViewportPubs({ isFocused, mapZoomRef }) {
  const { isConnected } = useNetworkStatus();
  const { showToast } = useToast();
  const [allPubs, setAllPubs] = useState([]);
  const [initialPubsReady, setInitialPubsReady] = useState(false);
  const [viewportBounds, setViewportBounds] = useState(null);

  const loadedPubBoundsRef = useRef(null);
  const inFlightPubFetchRef = useRef(false);
  const latestPubFetchTokenRef = useRef(0);
  const pubFetchTimeoutRef = useRef(null);
  /** When a fetch is already running, latest viewport bounds to fetch next (avoids dropped pans). */
  const pendingPubFetchBoundsRef = useRef(null);
  const awaitingInitialPubLoadRef = useRef(false);
  const initialPubsReadyRef = useRef(false);
  /** Bounds whose last load failed — never marked as loaded, retried later. */
  const failedBoundsRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const lastFailureToastAtRef = useRef(0);

  useEffect(() => () => {
    if (pubFetchTimeoutRef.current) clearTimeout(pubFetchTimeoutRef.current);
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
  }, []);

  const mergeFetchedPubs = useCallback((incomingPubs) => {
    setAllPubs((current) => {
      const nextById = new Map(current.map((pub) => [pub.id, pub]));
      (Array.isArray(incomingPubs) ? incomingPubs : []).forEach((pub) => {
        if (pub?.id) nextById.set(pub.id, pub);
      });
      return Array.from(nextById.values());
    });
  }, []);

  const markInitialPubsReady = useCallback(() => {
    if (initialPubsReadyRef.current) return;
    initialPubsReadyRef.current = true;
    awaitingInitialPubLoadRef.current = false;
    setInitialPubsReady(true);
  }, []);

  const requestViewportPubs = useCallback((boundsToFetch) => {
    if (!boundsToFetch) return;
    if (inFlightPubFetchRef.current) {
      pendingPubFetchBoundsRef.current = boundsToFetch;
      return;
    }
    inFlightPubFetchRef.current = true;
    const token = latestPubFetchTokenRef.current + 1;
    latestPubFetchTokenRef.current = token;

    fetchLondonPubs({ bounds: boundsToFetch })
      .then((pubs) => {
        if (latestPubFetchTokenRef.current !== token) return;
        mergeFetchedPubs(pubs);
        loadedPubBoundsRef.current = mergeBounds(loadedPubBoundsRef.current, boundsToFetch);
        failedBoundsRef.current = null;
      })
      .catch((error) => {
        // Leave these bounds unloaded so the next pan, the retry timer or reconnecting fetches again.
        console.warn('Failed to load viewport pubs:', error?.message ?? error);
        failedBoundsRef.current = boundsToFetch;
        if (Date.now() - lastFailureToastAtRef.current > FAILURE_TOAST_INTERVAL_MS) {
          lastFailureToastAtRef.current = Date.now();
          showToast(LOAD_FAILED_MESSAGE);
        }
        if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = setTimeout(() => {
          retryTimeoutRef.current = null;
          const failed = failedBoundsRef.current;
          if (failed && !boundsContain(loadedPubBoundsRef.current, failed)) requestViewportPubsRef.current?.(failed);
        }, RETRY_DELAY_MS);
      })
      .finally(() => {
        if (latestPubFetchTokenRef.current === token) {
          inFlightPubFetchRef.current = false;
        }
        if (awaitingInitialPubLoadRef.current) {
          markInitialPubsReady();
        }
        const pending = pendingPubFetchBoundsRef.current;
        pendingPubFetchBoundsRef.current = null;
        if (
          pending
          && !boundsContain(loadedPubBoundsRef.current, pending)
        ) {
          requestViewportPubs(pending);
        }
      });
  }, [markInitialPubsReady, mergeFetchedPubs, showToast]);

  const requestViewportPubsRef = useRef(requestViewportPubs);
  requestViewportPubsRef.current = requestViewportPubs;

  // Connection back: reload whatever failed while offline.
  useEffect(() => {
    if (!isConnected) return;
    const failed = failedBoundsRef.current;
    if (failed && !boundsContain(loadedPubBoundsRef.current, failed)) requestViewportPubs(failed);
  }, [isConnected, requestViewportPubs]);

  const requestInitialViewportPubs = useCallback(({ latitude, longitude, zoom }) => {
    if (initialPubsReadyRef.current) return;
    const effectiveZoom = Number.isFinite(zoom) ? zoom : mapZoomRef.current;
    if (!Number.isFinite(effectiveZoom) || effectiveZoom < MIN_PUB_FETCH_ZOOM) return;
    mapZoomRef.current = effectiveZoom;

    const bounds = approximateBoundsFromCenter(latitude, longitude, effectiveZoom);
    const bufferedBounds = expandBounds(bounds);
    if (!bufferedBounds) {
      markInitialPubsReady();
      return;
    }
    if (boundsContain(loadedPubBoundsRef.current, bufferedBounds)) {
      markInitialPubsReady();
      return;
    }

    awaitingInitialPubLoadRef.current = true;
    requestViewportPubs(bufferedBounds);
  }, [mapZoomRef, markInitialPubsReady, requestViewportPubs]);

  const scheduleViewportPubFetch = useCallback((nextBounds, zoomLevel) => {
    if (!isFocused) return;
    if (!nextBounds) return;
    const effectiveZoom = Number.isFinite(zoomLevel) ? zoomLevel : mapZoomRef.current;
    if (!Number.isFinite(effectiveZoom) || effectiveZoom < MIN_PUB_FETCH_ZOOM) return;

    const bufferedBounds = expandBounds(nextBounds);
    if (!bufferedBounds) return;
    if (boundsContain(loadedPubBoundsRef.current, bufferedBounds)) return;

    if (pubFetchTimeoutRef.current) clearTimeout(pubFetchTimeoutRef.current);
    pubFetchTimeoutRef.current = setTimeout(() => {
      requestViewportPubs(bufferedBounds);
    }, 80);
  }, [isFocused, mapZoomRef, requestViewportPubs]);

  useEffect(() => {
    if (!viewportBounds) return;
    scheduleViewportPubFetch(viewportBounds, mapZoomRef.current);
    return () => {
      if (pubFetchTimeoutRef.current) clearTimeout(pubFetchTimeoutRef.current);
    };
  }, [viewportBounds, mapZoomRef, scheduleViewportPubFetch]);

  const handleRegionChange = useCallback((event) => {
    const feature = event?.nativeEvent;
    const zoomLevel = Number.isFinite(feature?.zoomLevel) ? feature.zoomLevel : feature?.zoom;
    if (Number.isFinite(zoomLevel)) {
      mapZoomRef.current = zoomLevel;
    }
    const nextBounds = parseVisibleBounds(feature?.visibleBounds ?? feature?.bounds);
    if (nextBounds) {
      setViewportBounds((prev) => {
        if (
          prev &&
          Math.abs(prev.north - nextBounds.north) < 0.0005 &&
          Math.abs(prev.south - nextBounds.south) < 0.0005 &&
          Math.abs(prev.east - nextBounds.east) < 0.0005 &&
          Math.abs(prev.west - nextBounds.west) < 0.0005
        ) {
          return prev;
        }
        return nextBounds;
      });
      scheduleViewportPubFetch(nextBounds, zoomLevel);
    }
  }, [mapZoomRef, scheduleViewportPubFetch]);

  return {
    allPubs,
    setAllPubs,
    initialPubsReady,
    requestViewportPubs,
    requestInitialViewportPubs,
    scheduleViewportPubFetch,
    handleRegionChange,
    loadedPubBoundsRef,
  };
}
