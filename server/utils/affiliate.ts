/**
 * Helper to normalize URLs and enforce the Loja do Mecânico /20889 affiliate format.
 */

export const AFFILIATE_ID = '20889';

/**
 * Normalizes an original URL by removing query parameters, fragments, tracking tags, and trailing slash.
 */
export function normalizeProductUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url, 'https://www.lojadomecanico.com.br');
    let clean = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    clean = clean.replace(/\/20889\/?$/g, '');
    clean = clean.replace(/\/+$/, '');
    return clean;
  } catch {
    let clean = url.split('?')[0].split('#')[0];
    clean = clean.replace(/\/20889\/?$/g, '');
    clean = clean.replace(/\/+$/, '');
    return clean;
  }
}

/**
 * Returns the Loja do Mecânico numeric product id from /produto/{id}/...
 * This is more reliable than SKU for identity because the same SKU can have
 * legitimate variants such as 110V and 220V.
 */
export function extractLdmProductId(url: string): string | null {
  const normalized = normalizeProductUrl(url);
  const match = normalized.match(/\/produto\/(\d+)(?:\/|$)/i);
  return match?.[1] || null;
}

/**
 * Builds the real affiliate URL without duplicating /20889.
 */
export function buildAffiliateUrl(url: string): string {
  if (!url) return '';
  let clean = url.split('?')[0].split('#')[0].trim();
  clean = clean.replace(/\/+$/, '');

  if (clean.endsWith(`/${AFFILIATE_ID}`)) return clean;
  return `${clean}/${AFFILIATE_ID}`;
}

/**
 * Generates a stable identity for a Loja do Mecânico product.
 * Source product id is preferred because SKU may be shared by valid variants.
 */
export function generateProductIdentityKey(sku?: string, url?: string, name?: string): string {
  const productId = extractLdmProductId(url || '');
  if (productId) return `ldm:${productId}`;

  if (sku && sku.trim().length > 0) {
    const cleanSku = sku.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanSku.length > 0) return `sku:${cleanSku}`;
  }

  const normalizedUrl = normalizeProductUrl(url || '');
  if (normalizedUrl.length > 0) {
    try {
      const parsed = new URL(normalizedUrl);
      const pathClean = parsed.pathname.toLowerCase().replace(/\/+$/, '');
      if (pathClean) return `url:${pathClean}`;
    } catch {
      return `url:${normalizedUrl.toLowerCase()}`;
    }
  }

  if (name && name.trim().length > 0) {
    return `name:${name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 100)}`;
  }

  return `id:${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}
