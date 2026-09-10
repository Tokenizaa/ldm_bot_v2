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
    // Handle relative or full URLs
    const parsed = new URL(url, 'https://www.lojadomecanico.com.br');
    // Keep only protocol, host and pathname
    let clean = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    // If url previously contained /20889 at the end of pathname, strip it for original_url
    clean = clean.replace(/\/20889\/?$/g, '');
    clean = clean.replace(/\/+$/, '');
    return clean;
  } catch {
    // Fallback regex cleaning
    let clean = url.split('?')[0].split('#')[0];
    clean = clean.replace(/\/20889\/?$/g, '');
    clean = clean.replace(/\/+$/, '');
    return clean;
  }
}

/**
 * Requirement 5:
 * buildAffiliateUrl()
 * 1. remover query string;
 * 2. remover fragment;
 * 3. remover / final;
 * 4. verificar se já termina em /20889;
 * 5. caso não termine, acrescentar /20889.
 * Nunca gerar: /20889/20889
 */
export function buildAffiliateUrl(url: string): string {
  if (!url) return '';
  let clean = url.split('?')[0].split('#')[0].trim();
  clean = clean.replace(/\/+$/, '');

  if (clean.endsWith(`/${AFFILIATE_ID}`)) {
    return clean;
  }

  return `${clean}/${AFFILIATE_ID}`;
}

/**
 * Generates a stable product_identity_key with strict priority:
 * SKU -> Product Identity -> Normalized URL
 */
export function generateProductIdentityKey(sku?: string, url?: string, name?: string): string {
  if (sku && sku.trim().length > 0) {
    const cleanSku = sku.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanSku.length > 0) {
      return `sku:${cleanSku}`;
    }
  }

  const normalizedUrl = normalizeProductUrl(url || '');
  if (normalizedUrl.length > 0) {
    // Extract path segment (e.g. /produto/furadeira-impacto-123)
    try {
      const parsed = new URL(normalizedUrl);
      const pathClean = parsed.pathname.toLowerCase().replace(/\/+$/, '');
      if (pathClean) {
        return `url:${pathClean}`;
      }
    } catch {
      return `url:${normalizedUrl.toLowerCase()}`;
    }
  }

  // Fallback to normalized name
  if (name && name.trim().length > 0) {
    return `name:${name.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 100)}`;
  }

  return `id:${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}
