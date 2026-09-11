import * as cheerio from 'cheerio';
import { CrawlerRunResult } from '../types.js';
import { storage } from './StorageService.js';
import { logger } from './LoggerService.js';
import { buildAffiliateUrl, normalizeProductUrl, generateProductIdentityKey } from '../utils/affiliate.js';

const LDM_HOST = 'www.lojadomecanico.com.br';
const LDM_ORIGIN = `https://${LDM_HOST}`;
const TARGET_PRODUCTS = 150;

export interface RawScrapedProduct {
  name: string;
  current_price: number;
  sku?: string;
  url: string;
}

export class CrawlerService {
  private readonly defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
  };

  private isLdmProductUrl(url: string): boolean {
    try {
      const parsed = new URL(url, LDM_ORIGIN);
      return parsed.protocol === 'https:' &&
        parsed.hostname === LDM_HOST &&
        /^\/produto\/\d+(?:\/|$)/i.test(parsed.pathname) &&
        !/["'<>]|&quot;|&amp;|\\/i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  private isLdmCategoryUrl(url: string): boolean {
    try {
      const parsed = new URL(url, LDM_ORIGIN);
      return parsed.protocol === 'https:' &&
        parsed.hostname === LDM_HOST &&
        /^\/categorias\/\d+(?:\/[^/?#]+)?$/i.test(parsed.pathname) &&
        !/^\/subcategorias\//i.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  private normalizeCategoryUrl(url: string, baseUrl = LDM_ORIGIN): string {
    const parsed = new URL(url, baseUrl);
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = LDM_HOST;
    return parsed.toString().replace(/\/$/, '');
  }

  private parsePrice(value: unknown): number {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return NaN;
    const match = text.match(/R\$\s*([\d.]+(?:,\d{1,2})?)/i) || text.match(/([\d.]+,\d{1,2})/);
    if (!match) return NaN;
    return Number(match[1].replace(/\./g, '').replace(',', '.'));
  }

  private async fetchPage(url: string, timeoutMs = 20000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { ...this.defaultHeaders, Referer: `${LDM_ORIGIN}/` },
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status} ao acessar ${url}`);
      const html = await response.text();
      if (!html.trim()) throw new Error(`HTML vazio ao acessar ${url}`);
      return html;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Descobre apenas categorias de primeiro nível a partir da navegação real da Home.
   * Nunca usa /categoria (rota antiga) nem /subcategorias nesta etapa.
   */
  extractCategoryUrls(html: string): string[] {
    const categories = new Set<string>();
    const $ = cheerio.load(html);

    $('a[href*="/categorias/"]').each((_index, element) => {
      const href = String($(element).attr('href') || '').trim();
      if (!href) return;
      try {
        const url = new URL(href, LDM_ORIGIN);
        if (!this.isLdmCategoryUrl(url.toString())) return;
        categories.add(this.normalizeCategoryUrl(url.toString()));
      } catch {
        // Ignore malformed links.
      }
    });

    return [...categories];
  }

  /**
   * Extrai somente o que existe no card do grid.
   * Não abre produto individual, não usa JSON-LD e não usa OpenGraph.
   */
  extractProductsFromGrid(html: string): RawScrapedProduct[] {
    const products: RawScrapedProduct[] = [];
    const seenUrls = new Set<string>();
    const $ = cheerio.load(html);

    $('.product-item.p-0').each((_index, card) => {
      if (products.length >= TARGET_PRODUCTS) return;

      const cardRoot = $(card);
      const link = cardRoot.find('a.tag-a.show-bg-preloader.tagManagerProductClick[href]').first();
      const href = String(link.attr('href') || '').trim();
      const name = cardRoot.find('.product-description').first().text().replace(/\s+/g, ' ').trim();
      const priceText = cardRoot.find('p.price').first().text();
      const price = this.parsePrice(priceText);

      if (!href || !name || !Number.isFinite(price) || price <= 0) return;

      let productUrl: string;
      try {
        productUrl = normalizeProductUrl(new URL(href, LDM_ORIGIN).toString());
      } catch {
        return;
      }

      if (!this.isLdmProductUrl(productUrl) || seenUrls.has(productUrl)) return;
      seenUrls.add(productUrl);

      let sku: string | undefined;
      const rawDataProduct = String(link.attr('data-product') || '').trim();
      if (rawDataProduct) {
        try {
          const data = JSON.parse(rawDataProduct) as Record<string, unknown>;
          const code = data.codigo ?? data.sku ?? data.mpn;
          if (typeof code === 'string' && code.trim()) sku = code.trim();
        } catch {
          // SKU is optional. Never invent it when data-product is invalid.
        }
      }

      products.push({ name, current_price: price, sku, url: productUrl });
    });

    return products;
  }

  /**
   * Mantido para compatibilidade com chamadas existentes, mas propositalmente
   * não abre páginas individuais. A coleta de produção é feita pelo grid.
   */
  async scrapeProductPage(_url: string): Promise<RawScrapedProduct | null> {
    return null;
  }

  async run(): Promise<CrawlerRunResult> {
    const homeHtml = await this.fetchPage(`${LDM_ORIGIN}/`);
    const discoveredCategories = this.extractCategoryUrls(homeHtml);

    if (!discoveredCategories.length) {
      throw new Error('Nenhuma categoria /categorias/* foi encontrada na Home.');
    }

    logger.crawler(`Home: ${discoveredCategories.length} categorias de primeiro nível encontradas.`);

    const products: RawScrapedProduct[] = [];
    const identities = new Set<string>();
    const visitedCategories = new Set<string>();

    for (const categoryUrl of discoveredCategories) {
      if (products.length >= TARGET_PRODUCTS) break;
      if (visitedCategories.has(categoryUrl)) continue;
      visitedCategories.add(categoryUrl);

      try {
        const html = await this.fetchPage(categoryUrl);
        const categoryProducts = this.extractProductsFromGrid(html);
        let added = 0;

        for (const raw of categoryProducts) {
          if (products.length >= TARGET_PRODUCTS) break;

          const originalUrl = normalizeProductUrl(raw.url);
          const affiliateUrl = buildAffiliateUrl(originalUrl);
          if (!this.isLdmProductUrl(originalUrl) || !affiliateUrl.endsWith('/20889')) continue;

          const identity = generateProductIdentityKey(raw.sku, originalUrl, raw.name);
          if (identities.has(identity)) continue;
          identities.add(identity);
          products.push({ ...raw, url: originalUrl });
          added++;
        }

        logger.crawler(`Categoria ${categoryUrl}: ${categoryProducts.length} cards válidos; ${added} novos; total ${products.length}/${TARGET_PRODUCTS}.`);
      } catch (error: any) {
        logger.crawler(`Aviso ao acessar categoria ${categoryUrl}: ${error?.message || String(error)}`, 'warn');
      }
    }

    if (products.length < TARGET_PRODUCTS) {
      throw new Error(`Coleta incompleta: ${products.length}/${TARGET_PRODUCTS} produtos reais válidos. Foram verificadas ${visitedCategories.size} categorias.`);
    }

    let valid = 0;
    let created = 0;
    let updated = 0;

    for (const raw of products) {
      const originalUrl = normalizeProductUrl(raw.url);
      const affiliateUrl = buildAffiliateUrl(originalUrl);
      const identity = generateProductIdentityKey(raw.sku, originalUrl, raw.name);

      const result = await storage.upsertProduct({
        product_identity_key: identity,
        product_name: raw.name,
        brand: 'Loja do Mecânico',
        category: 'Ferramentas',
        sku: raw.sku,
        original_url: originalUrl,
        affiliate_url: affiliateUrl,
        current_price: raw.current_price,
        active: true,
      });

      valid++;
      if (result.isNew) created++;
      else updated++;
    }

    if (valid !== TARGET_PRODUCTS) {
      throw new Error(`Persistência incompleta: ${valid}/${TARGET_PRODUCTS}.`);
    }

    logger.crawler(`Coleta concluída: ${valid} produtos reais; ${created} novos; ${updated} atualizados.`);
    return { found: products.length, valid, new: created, updated };
  }
}

export const crawler = new CrawlerService();
