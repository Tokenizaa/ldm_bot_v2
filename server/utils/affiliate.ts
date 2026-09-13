/**
 * Canonical Loja do Mecânico affiliate URL builder.
 *
 * Publication format:
 *   <normalized-product-path>/<AFFILIATE_ID>?afiliado=<GLOBAL_CODE>
 *
 * The UTM URL supplied by the affiliate dashboard is intentionally not used
 * for Facebook publication because the tested `afiliado` query format keeps
 * the affiliate tracking signal while producing the expected Facebook card.
 */

export const AFFILIATE_ID = process.env.AFFILIATE_ID?.trim() || '20889';
export const AFFILIATE_GLOBAL_CODE = process.env.AFFILIATE_GLOBAL_CODE?.trim() || '0S7w4Sy5S12oCKmeTo3Z3g==';

/**
 * Normalizes an original product URL by removing query parameters, fragments,
 * the affiliate ID suffix and trailing slash.
 */
export function normalizeProductUrl(url: string): string {
  if (!url) return '';
  try {
    const parsed = new URL(url, 'https://www.lojadomecanico.com.br');
    let clean = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    const affiliateSuffix = new RegExp(`/${escapeRegExp(AFFILIATE_ID)}/?$`, 'i');
    clean = clean.replace(affiliateSuffix, '');
    clean = clean.replace(/\/+$/, '');
    return clean;
  } catch {
    let clean = url.split('?')[0].split('#')[0];
    const affiliateSuffix = new RegExp(`/${escapeRegExp(AFFILIATE_ID)}/?$`, 'i');
    clean = clean.replace(affiliateSuffix, '');
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
 * Builds the canonical affiliate URL used by the Facebook publisher.
 *
 * This function is intentionally idempotent: calling it with an already
 * affiliated URL produces exactly the same URL.
 */
export function buildAffiliateUrl(url: string): string {
  const normalized = normalizeProductUrl(url);
  if (!normalized) return '';

  const parsed = new URL(normalized);
  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = `${parsed.pathname.replace(/\/+$/, '')}/${AFFILIATE_ID}`;
  parsed.searchParams.set('afiliado', AFFILIATE_GLOBAL_CODE);
  return parsed.toString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
