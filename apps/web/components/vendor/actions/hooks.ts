'use client';
import { useSyncExternalStore } from 'react';
import { approvedTransfersStore, ordersStore, thresholdVersion, type DemoOrder, type Store } from '../../../lib/demo-vendor-actions';

function useStore<T>(s: Store<T>): T { return useSyncExternalStore(s.subscribe, s.get, () => s.server); }

/** The demo orders kept in this browser, oldest first (an empty list on the server and until the page has loaded). */
export const useOrders = (): DemoOrder[] => useStore(ordersStore);
/** The ids of the approved stock transfers kept in this browser. */
export const useApprovedTransfers = (): string[] => useStore(approvedTransfersStore);
/** A number that changes whenever the alert thresholds change (this tab or another): a dependency of anything computed from stock statuses. */
export const useThresholdsVersion = (): number => useStore(thresholdVersion);
