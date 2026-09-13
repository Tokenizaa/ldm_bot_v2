import crypto from 'crypto';
import { storage } from './StorageService.js';

/**
 * Phase 5 safety boundary.
 * The legacy StorageService still contains publication/price-history methods for
 * compatibility with old code paths, but the live application is catalog-only.
 * This guard makes those legacy writes inert or explicitly blocked.
 */
export function installCatalogOnlyStorageGuard(): void {
  const guarded = storage as any;

  guarded.addPriceHistory = async (entry: { product_id: string; price: number; checked_at?: string }) => ({
    id: crypto.randomUUID(),
    product_id: entry.product_id,
    price: entry.price,
    checked_at: entry.checked_at || new Date().toISOString(),
  });

  const blocked = (name: string) => async () => {
    throw new Error(`CATALOG_ONLY_MODE: ${name} não grava estado operacional no banco.`);
  };

  guarded.createPublication = blocked('createPublication');
  guarded.updatePublication = blocked('updatePublication');
  guarded.deletePublication = blocked('deletePublication');
  guarded.resetPublicationForRetry = blocked('resetPublicationForRetry');
  guarded.deleteFailedPublications = blocked('deleteFailedPublications');
}
