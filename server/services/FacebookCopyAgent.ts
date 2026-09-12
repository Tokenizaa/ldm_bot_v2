import { Product } from '../types.js';
import { nvidiaAI } from './NvidiaAIService.js';
import { logger } from './LoggerService.js';

export interface FacebookCopyResult {
  success: boolean;
  content: string;
  model: string;
  tokensUsed?: number;
  error?: string;
}

/**
 * Canonical Facebook product-copy agent.
 * Product data is the only factual source; AI wording is accepted only after
 * the same local safety gate used by persisted and deterministic copies.
 */
export class FacebookCopyAgent {
  async generate(product: Product, customModel?: string): Promise<FacebookCopyResult> {
    const model = customModel || process.env.NVIDIA_MODEL || undefined;
    const productName = this.cleanProductName(product.product_name);
    const brand = this.cleanField(product.brand);
    const category = this.cleanField(product.category);
    const sku = this.cleanField(product.sku);

    if (!nvidiaAI.isConfigured()) {
      return {
        success: true,
        content: this.buildDeterministicCopy(productName, brand, category, sku),
        model: model || 'deterministic',
        error: 'NVIDIA_API_KEY não configurada; copy determinística utilizada.'
      };
    }

    const systemPrompt = [
      'Você cria a copy final de um anúncio de produto para um grupo brasileiro do Facebook.',
      'Retorne SOMENTE a publicação final, sem análise, raciocínio, explicações, rótulos ou markdown de campos.',
      'Use exclusivamente os dados fornecidos do produto.',
      'O nome pode conter especificações técnicas reais; preserve-as quando forem úteis.',
      'Não invente características, benefícios, usos, avaliações, estoque, frete, garantia, urgência, preço, desconto ou promoção.',
      'Não escreva URL; o link será inserido separadamente pelo publicador.',
      'Escreva uma copy comercial natural, com SEO semântico e mais contexto do que apenas repetir o título.',
      'Inclua @todos exatamente uma vez em uma linha própria.',
      'Use de 3 a 4 hashtags SEO semanticamente derivadas do nome, marca ou categoria.',
      'Hashtags compostas são permitidas quando formadas por palavras existentes no produto, por exemplo #CaboDeVela a partir de "Cabo de Vela".',
      'Finalize com uma CTA factual para conhecer ou conferir o produto, sem prometer oferta, desconto ou preço.'
    ].join('\n');

    const userPrompt = [
      'DADOS DO PRODUTO — NÃO COPIAR ESTES RÓTULOS PARA A PUBLICAÇÃO',
      'Nome: ' + productName,
      'Marca: ' + (brand || 'não informada'),
      'Categoria: ' + (category || 'não informada'),
      'SKU: ' + (sku || 'não informado')
    ].join('\n');

    const first = await nvidiaAI.generateRawCopy(systemPrompt, userPrompt, model);
    if (first.success) {
      const normalized = this.normalizeAndValidate(first.content, productName, brand, category, sku);
      if (normalized) return { ...first, success: true, content: normalized };
      logger.ai('Modelo retornou copy inválida/contaminada; usando fallback determinístico.', 'warn');
    }

    const deterministic = this.buildDeterministicCopy(productName, brand, category, sku);
    return {
      success: true,
      content: deterministic,
      model: first.model || model || 'deterministic',
      tokensUsed: first.tokensUsed,
      error: first.success ? undefined : first.error
    };
  }

  private cleanProductName(value: string): string {
    let name = this.cleanField(value) || 'Produto';

    name = name
      .replace(/\s+(?:Entrega(?:\s+Frete\s+Grátis(?:\s+Para\s+todo\s+o\s+Brasil)?)?)(?:\s+\d+(?:[.,]\d+)?)?\s*$/i, '')
      .replace(/\s+(?:Frete\s+Grátis(?:\s+Para\s+todo\s+o\s+Brasil)?)(?:\s+\d+(?:[.,]\d+)?)?\s*$/i, '')
      .replace(/\s+\d[.,]\d\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();

    return name || 'Produto';
  }

  private cleanField(value?: string): string {
    return String(value || '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  isPublicationReady(raw: string, product: Product): boolean {
    const productName = this.cleanProductName(product.product_name);
    const brand = this.cleanField(product.brand);
    const category = this.cleanField(product.category);
    const sku = this.cleanField(product.sku);
    return Boolean(this.normalizeAndValidate(raw, productName, brand, category, sku));
  }

  async ensurePublicationCopy(product: Product, existingCopy?: string, customModel?: string): Promise<string> {
    const productName = this.cleanProductName(product.product_name);
    const brand = this.cleanField(product.brand);
    const category = this.cleanField(product.category);
    const sku = this.cleanField(product.sku);

    if (existingCopy) {
      const existingNormalized = this.normalizeAndValidate(existingCopy, productName, brand, category, sku);
      if (existingNormalized) return existingNormalized;
    }

    const generated = await this.generate(product, customModel);
    const normalized = this.normalizeAndValidate(generated.content, productName, brand, category, sku);
    return normalized || this.buildDeterministicCopy(productName, brand, category, sku);
  }

  private normalizeAndValidate(
    raw: string,
    productName: string,
    brand: string,
    category: string,
    sku: string
  ): string | null {
    let content = String(raw || '')
      .replace(/https?:\/\/\S+|www\.\S+/gi, '')
      .replace(/\r/g, '')
      .trim();

    const forbiddenMeta = [
      /\b(?:system prompt|user prompt|fonte de verdade|regras absolutas|dados reais do produto)\b/i,
      /\b(?:we need to|let'?s craft|let'?s place|check:|however,|actually,|we need to ensure|the name includes)\b/i,
      /\b(?:vamos criar|vamos montar|precisamos garantir|verifique:)\b/i,
      /(?:^|\n)\s*(?:copy|análise|analise|explicação|explicacao|raciocínio|raciocinio)\s*:/i,
      /(?:^|\n)\s*(?:nome|marca|categoria|sku|produto)\s*:/i,
      /\b(?:instrução|instrucao|modelo deve|resposta do modelo)\b/i
    ];
    if (forbiddenMeta.some(re => re.test(content))) return null;

    content = content
      .replace(/^\s*[\`"]{1,3}/, '')
      .replace(/[\`"]{1,3}\s*$/g, '')
      .trim();

    content = content.replace(/@todos\b/gi, '').trim();
    if (!content) return null;

    const hashtags = content.match(/#[\p{L}\p{N}_]+/gu) || [];
    if (hashtags.length > 4) return null;
    if (/\b(?:r\$|rs\$|preço|preco|valor)\s*[:=-]?\s*\d/i.test(content)) return null;
    if (/\b(?:desconto|promoção|promocao|oferta\s+imperdível|imperdível|imperdivel|frete\s+grátis|frete\s+gratis|entrega\s+grátis|entrega\s+gratis)\b/i.test(content)) return null;
    if (content.length > 650) return null;

    const identityTokens = [productName, brand, category, sku].filter(Boolean);
    if (!identityTokens.some(v => content.toLowerCase().includes(v.toLowerCase()))) return null;

    const sourceNormalized = this.normalizeSearchText(identityTokens.join(' '));
    for (const tag of hashtags) {
      const token = this.normalizeSearchText(tag.slice(1));
      if (!token || !sourceNormalized.includes(token)) return null;
    }

    if (!/\b(?:confira|conheça|conheca|veja|descubra|saiba mais)\b/i.test(content)) return null;

    const body = content.replace(/(?:^|\n)\s*(?:#[\p{L}\p{N}_]+\s*)+$/u, '').trim();
    if (!body || body.includes('#')) return null;

    const final = [body, '@todos', hashtags.join(' ')].filter(Boolean).join('\n\n').trim();
    if ((final.match(/@todos\b/gi) || []).length !== 1) return null;
    if (/https?:\/\/|www\./i.test(final) || final.length > 700) return null;

    return final;
  }

  private normalizeSearchText(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .toLowerCase();
  }

  /**
   * Final fallback is intentionally publication-ready by construction.
   * It contains no "Categoria:"/"SKU:" metadata labels.
   */
  private buildDeterministicCopy(
    productName: string,
    brand: string,
    category: string,
    sku: string
  ): string {
    const identity = [productName, brand].filter(Boolean).join(' — ');
    const seoSentence = [
      'Conheça',
      identity || productName,
      category ? 'na categoria ' + category : '',
      sku && !productName.toLowerCase().includes(sku.toLowerCase()) ? 'referência ' + sku : ''
    ].filter(Boolean).join(' ') + '.';

    return [
      '🔧 ' + identity,
      seoSentence,
      'Confira o produto e veja todos os detalhes.',
      '@todos',
      this.buildHashtags(productName, brand, category).join(' ')
    ].filter(Boolean).join('\n\n');
  }

  private buildHashtags(productName: string, brand: string, category: string): string[] {
    const source = [productName, brand, category].filter(Boolean).join(' ');
    const words = source
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, ' ')
      .split(/\s+/)
      .filter(Boolean);

    const stop = new Set([
      'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em', 'e',
      'um', 'uma', 'por', 'tipo', 'pol', 'mm', 'cm', 'm', 'v', 'w',
      'entrega', 'frete', 'gratis', 'brasil', 'a', 'o', 'as', 'os'
    ]);

    const significant = words.filter(word =>
      word.length >= 3 &&
      !stop.has(word.toLowerCase()) &&
      !/^\d+(?:[.,]\d+)?$/.test(word)
    );

    const tags: string[] = [];
    const add = (value: string) => {
      if (!value) return;
      const tag = '#' + value;
      if (!tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    };

    // Build semantic phrases by skipping stop words between meaningful terms.
    // Example: "Testador para Cabo de Vela" -> #TestadorCaboVela and #CaboVela.
    for (let i = 0; i < significant.length && tags.length < 2; i++) {
      const phrase = significant.slice(i, i + 3);
      if (phrase.length >= 2) add(phrase.map(this.toTagWord).join(''));
    }

    if (brand) {
      const brandWords = brand
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      add(brandWords.map(this.toTagWord).join(''));
    }

    if (category) {
      const categoryWords = category
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
      add(categoryWords.map(this.toTagWord).join(''));
    }

    for (const word of significant) {
      if (tags.length >= 4) break;
      add(this.toTagWord(word));
    }

    return tags.slice(0, 4);
  }

  private toTagWord(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
}

export const facebookCopyAgent = new FacebookCopyAgent();
