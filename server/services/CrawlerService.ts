import * as cheerio from 'cheerio';
import { CrawlerRunResult } from '../types.js';
import { storage } from './StorageService.js';
import { logger } from './LoggerService.js';
import {
  buildAffiliateUrl,
  normalizeProductUrl,
  generateProductIdentityKey
} from '../utils/affiliate.js';

export interface RawScrapedProduct {
  name: string;
  current_price: number;
  previous_price?: number;
  brand?: string;
  category?: string;
  sku?: string;
  image_url?: string;
  url: string;
}

export class CrawlerService {
  private defaultHeaders = {
    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
  };

  /**
   * Fetches an HTML page with timeout and standard indexing headers
   */
  private async fetchPage(url: string, timeoutMs = 12000): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: this.defaultHeaders
      });

      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ao acessar ${url}`);
      }

      return await response.text();
    } catch (err: any) {
      clearTimeout(timer);
      throw err;
    }
  }

  /**
   * Extracts Product Schema JSON-LD from HTML
   */
  extractJsonLdProduct(html: string, pageUrl: string): RawScrapedProduct | null {
    const $ = cheerio.load(html);
    let foundProduct: RawScrapedProduct | null = null;

    $('script[type="application/ld+json"]').each((_, el) => {
      if (foundProduct) return;
      try {
        const rawContent = $(el).html();
        if (!rawContent) return;
        const parsed = JSON.parse(rawContent);
        const items = Array.isArray(parsed) ? parsed : [parsed];

        for (const item of items) {
          if (item['@type'] === 'Product') {
            const rawPrice = item.offers?.price || item.offers?.lowPrice || item.offers?.highPrice;
            const price = typeof rawPrice === 'number' ? rawPrice : parseFloat(String(rawPrice || '0').replace(',', '.'));
            const name = item.name?.trim();
            const rawUrl = item.offers?.url || item.url || pageUrl;

            if (name && price > 0) {
              const brand = typeof item.brand === 'object' ? item.brand?.name : item.brand;
              const imageUrl = Array.isArray(item.image) ? item.image[0] : item.image;
              const sku = item.sku || item.mpn || item.productId;

              foundProduct = {
                name,
                current_price: price,
                brand: brand ? String(brand).trim() : undefined,
                category: item.category ? String(item.category).trim() : undefined,
                sku: sku ? String(sku).trim() : undefined,
                image_url: imageUrl ? String(imageUrl).trim() : undefined,
                url: rawUrl
              };
              return false; // break loop
            }
          }
        }
      } catch {
        // Skip malformed JSON-LD scripts
      }
    });

    return foundProduct;
  }

  /**
   * DOM fallback extraction when JSON-LD is unavailable
   */
  extractDomProduct(html: string, pageUrl: string): RawScrapedProduct | null {
    const $ = cheerio.load(html);

    const title = $('meta[property="og:title"]').attr('content') ||
                  $('h1.product-title, h1[data-testid="product-title"], h1').first().text().trim();
    const image = $('meta[property="og:image"]').attr('content') ||
                  $('.product-image img, [data-testid="product-image"]').first().attr('src');

    // Price extraction
    let price = 0;
    const metaPrice = $('meta[property="product:price:amount"]').attr('content');
    if (metaPrice) {
      price = parseFloat(metaPrice.replace(',', '.'));
    } else {
      const priceText = $('.preco-avista, .price, .product-price, [data-testid="price"]').first().text().trim();
      if (priceText) {
        price = parseFloat(priceText.replace(/[^0-9,.]/g, '').replace('.', '').replace(',', '.'));
      }
    }

    if (!title || price <= 0) {
      return null;
    }

    const sku = $('[data-sku]').attr('data-sku') || $('.product-sku, .sku').first().text().replace(/[^0-9A-Za-z-]/g, '').trim();
    const brand = $('[data-brand]').attr('data-brand') || $('.product-brand, .brand').first().text().trim();

    return {
      name: title,
      current_price: price,
      brand: brand || undefined,
      sku: sku || undefined,
      image_url: image || undefined,
      url: pageUrl
    };
  }

  /**
   * Collects genuine product URLs from index/category pages
   */
  extractProductUrlsFromListing(html: string): string[] {
    const urls = new Set<string>();
    const matches = [...html.matchAll(/href=["'](\/produto\/[0-9]+[^"']*)["']/gi)];

    for (const match of matches) {
      const path = match[1];
      if (path && !path.includes('/carrinho') && !path.includes('/checkout')) {
        const full = path.startsWith('http')
          ? path
          : `https://www.lojadomecanico.com.br${path.startsWith('/') ? '' : '/'}${path}`;
        urls.add(full);
      }
    }

    // Also look for absolute URLs in html
    const absMatches = [...html.matchAll(/https:\/\/www\.lojadomecanico\.com\.br\/produto\/[0-9]+[^\s"']+/gi)];
    for (const match of absMatches) {
      urls.add(match[0]);
    }

    return Array.from(urls);
  }

  /**
   * Scrapes a single real product by its Loja do Mecânico URL
   */
  async scrapeProductPage(url: string): Promise<RawScrapedProduct | null> {
    try {
      const html = await this.fetchPage(url);
      const jsonLd = this.extractJsonLdProduct(html, url);
      if (jsonLd) {
        return jsonLd;
      }
      return this.extractDomProduct(html, url);
    } catch (err: any) {
      logger.crawler(`Falha ao raspar página de produto individual (${url}): ${err.message}`, 'warn');
      return null;
    }
  }

  /**
   * Runs the REAL crawler against Loja do Mecânico.
   * ZERO hardcoded catalog.
   * ZERO fake fallback.
   * If scraping fails to find real products, throws an error.
   */
  async run(): Promise<CrawlerRunResult> {
    logger.crawler('Started: Conectando diretamente à Loja do Mecânico (https://www.lojadomecanico.com.br)...');

    const listingUrls = [
      'https://www.lojadomecanico.com.br/',
      'https://www.lojadomecanico.com.br/categoria/ferramentas-eletricas',
      'https://www.lojadomecanico.com.br/categoria/ferramentas-manuais'
    ];

    const discoveredProductUrls = new Set<string>();

    for (const listUrl of listingUrls) {
      try {
        logger.crawler(`Acessando catálogo: ${listUrl}`);
        const html = await this.fetchPage(listUrl);
        const extracted = this.extractProductUrlsFromListing(html);
        extracted.forEach(u => discoveredProductUrls.add(u));
        logger.crawler(`Encontradas ${extracted.length} URLs de produtos em ${listUrl}`);
      } catch (err: any) {
        logger.crawler(`Aviso ao acessar ${listUrl}: ${err.message}`, 'warn');
      }
    }

    const candidateUrls = Array.from(discoveredProductUrls);

    if (candidateUrls.length === 0) {
      const errorMsg = 'Crawler da Loja do Mecânico falhou: nenhuma URL de produto encontrada nas páginas oficiais.';
      logger.crawler(errorMsg, 'error');
      throw new Error(errorMsg);
    }

    logger.crawler(`Total de ${candidateUrls.length} produtos descobertos. Extraindo detalhes reais...`);

    // Scrape up to 15 real products per run
    const targetSlice = candidateUrls.slice(0, 15);
    const scrapedProducts: RawScrapedProduct[] = [];

    for (const prodUrl of targetSlice) {
      const prod = await this.scrapeProductPage(prodUrl);
      if (prod) {
        scrapedProducts.push(prod);
      }
    }

    if (scrapedProducts.length === 0) {
      const errorMsg = 'Crawler falhou: não foi possível extrair dados válidos de nenhum dos produtos encontrados.';
      logger.crawler(errorMsg, 'error');
      throw new Error(errorMsg);
    }

    logger.crawler(`Found ${scrapedProducts.length} products reais`);

    let validCount = 0;
    let newCount = 0;
    let updatedCount = 0;

    for (const raw of scrapedProducts) {
      // Requisito 2: Aceitar somente product_name != null, original_url != null, current_price > 0
      if (!raw.name || !raw.url || !raw.current_price || raw.current_price <= 0) {
        continue;
      }

      validCount++;

      const originalUrl = normalizeProductUrl(raw.url);
      const affiliateUrl = buildAffiliateUrl(originalUrl);

      // Requisito 3: Garantir affiliate_url.endsWith("/20889") antes de salvar
      if (!affiliateUrl.endsWith('/20889')) {
        logger.crawler(`URL de afiliado inválida para "${raw.name}": ${affiliateUrl}`, 'error');
        continue;
      }

      const identityKey = generateProductIdentityKey(raw.sku, originalUrl, raw.name);

      const productPayload = {
        product_identity_key: identityKey,
        product_name: raw.name,
        brand: raw.brand || 'Loja do Mecânico',
        category: raw.category || 'Ferramentas',
        sku: raw.sku,
        original_url: originalUrl,
        affiliate_url: affiliateUrl,
        current_price: raw.current_price,
        previous_price: raw.previous_price,
        image_url: raw.image_url,
        active: true,
        last_scraped_at: new Date().toISOString()
      };

      const result = await storage.upsertProduct(productPayload);

      if (result.isNew) {
        newCount++;
      } else {
        updatedCount++;
        if (result.priceChanged) {
          logger.crawler(`Preço atualizado para "${raw.name}": R$ ${raw.current_price.toFixed(2)}`);
        }
      }
    }

    logger.crawler(`${validCount} valid`);
    logger.crawler(`${newCount} new`);
    logger.crawler(`${updatedCount} updated`);

    return {
      found: scrapedProducts.length,
      valid: validCount,
      new: newCount,
      updated: updatedCount
    };
  }
}

export const crawler = new CrawlerService();
