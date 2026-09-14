import { storage } from './StorageService.js';

/**
 * Catalog-only guard.
 * Publication writes are now allowed so the scheduler can persist to the posts
 * ledger for permanent deduplication.  Price-history writes remain handled by
 * the real StorageService implementation.
 */
export function installCatalogOnlyStorageGuard(): void {
  // Intentionally empty — all storage writes are live.
  void storage;
}
