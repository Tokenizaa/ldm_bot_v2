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
 * The copy is intentionally short, readable and mobile-friendly.
 *
 * Hashtags are controlled by the application, not by the LLM. The model is
 * responsible for the short body copy; the system always derives 3-4 SEO
 * hashtags from the product data so a valid model response cannot be rejected
 * just because the model omitted or formatted hashtags differently.
 */
export class FacebookCopyAgent {
  async generate(product: Product, customModel?: string): Promise<FacebookCopyResult> {
    const model = customModel || process.env.NVIDIA_MODEL || undefined;
    const productName = this.cleanProductName(product.product_name);
    const brand = this.cleanField(product.brand);
    const category = this.cleanField(product.category);
    const sku = this.cleanField(product.sku);

    if (!nvidiaAI.isConfigured()) {
      const deterministic = this.buildDeterministicCopy(productName, brand, category, sku);
      return {
        success: true,
        content: deterministic,
        model: model || 'deterministic',
        error: 'NVIDIA_API_KEY não configurada; copy determinística utilizada.'
      };
    }

    const systemPrompt = [
      'Você cria a publicação final de um produto para um grupo brasileiro do Facebook.',
      'A publicação precisa ser MUITO curta, simples e fácil de ler no celular.',
      'Retorne somente a publicação final.',
      'Use exclusivamente os dados fornecidos do produto e não invente informações.',
      'Não informe preço, desconto, promoção, frete, estoque, garantia ou avaliações.',
      'Não escreva URL; o link será inserido separadamente.',
      'Use 2 frases curtas de venda, naturais e objetivas.',
      'Use o nome do produto naturalmente dentro das frases, sem criar um título separado.',
      'Pode usar 1 ou 2 ícones simples para facilitar a leitura.',
      'Use no máximo 2 parágrafos curtos.',
      'Não precisa gerar @todos nem hashtags; o sistema adicionará esses elementos automaticamente.',
      'Não use rótulos como Categoria:, SKU:, Marca: ou Produto:.',
      'Não escreva explicações, análise ou instruções.',
      'Finalize com uma CTA curta como Confira os detalhes ou Veja as especificações.'
    ].join('\n');

    const userPrompt = [
      'DADOS DO PRODUTO — use como fonte factual, sem copiar os rótulos:',
      'Nome: ' + productName,
      'Marca: ' + (brand || 'não informada'),
      'Categoria: ' + (category || 'não informada'),
      'SKU: ' + (sku || 'não informado')
    ].join('\n');

    const first = await nvidiaAI.generateRawCopy(systemPrompt, userPrompt, model);
    if (first.success) {
      const normalized = this.normalizeAndValidate(first.content, productName, brand, category, sku);
      if (normalized) return { ...first, success: true, content: normalized };
      logger.ai(`COPY_VALIDATION_FAILED source=ai product="${productName}" reason=${this.validationReason(first.content, productName, brand, category, sku)}`, 'warn');
    }

    const deterministic = this.buildDeterministicCopy(productName, brand, category, sku);
    const normalizedDeterministic = this.normalizeAndValidate(deterministic, productName, brand, category, sku);
    if (!normalizedDeterministic) {
      const reason = this.validationReason(deterministic, productName, brand, category, sku);
      logger.ai(`COPY_VALIDATION_FAILED source=deterministic product="${productName}" reason=${reason}`, 'error');
      throw new Error(`FACEBOOK_COPY_DETERMINISTIC_INVALID:${reason}`);
    }

    return {
      success: true,
      content: normalizedDeterministic,
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

  getPublicationValidationReason(raw: string, product: Product): string {
    const productName = this.cleanProductName(product.product_name);
    const brand = this.cleanField(product.brand);
    const category = this.cleanField(product.category);
    const sku = this.cleanField(product.sku);
    return this.validationReason(raw, productName, brand, category, sku);
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
    if (normalized) return normalized;

    const deterministic = this.buildDeterministicCopy(productName, brand, category, sku);
    const normalizedDeterministic = this.normalizeAndValidate(deterministic, productName, brand, category, sku);
    if (!normalizedDeterministic) {
      const reason = this.validationReason(deterministic, productName, brand, category, sku);
      throw new Error(`FACEBOOK_COPY_DETERMINISTIC_INVALID:${reason}`);
    }
    return normalizedDeterministic;
  }

  private normalizeAndValidate(raw: string, productName: string, brand: string, category: string, sku: string): string | null {
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

    // Hashtags and @todos are system-controlled. Remove any model-generated
    // versions before validating the actual publication body.
    content = content.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]{2,}/g, ' ').trim();

    if (/\b(?:r\$|rs\$|preço|preco|valor)\s*[:=-]?\s*\d/i.test(content)) return null;
    if (/\b(?:desconto|promoção|promocao|oferta\s+imperdível|imperdível|imperdivel|frete\s+grátis|frete\s+gratis|entrega\s+grátis|entrega\s+gratis)\b/i.test(content)) return null;
    if (content.length > 420) return null;

    const identityTokens = [productName, brand, category, sku].filter(Boolean);
    if (!identityTokens.some(v => content.toLowerCase().includes(v.toLowerCase()))) return null;

    const bodyLines = content.split('\n').map(line => line.trim()).filter(Boolean);
    const normalizedProductName = this.normalizeSearchText(productName);
    const firstLineNormalized = this.normalizeSearchText(bodyLines[0]?.replace(/^[🔧🛠️📌⭐📐⚙️]+\s*/, '') || '');
    if (firstLineNormalized === normalizedProductName || firstLineNormalized.startsWith(normalizedProductName)) return null;
    if (/^(?:categoria|sku|marca|produto)\s*:/i.test(bodyLines[0] || '')) return null;

    if (!/\b(?:confira|conheça|conheca|veja|descubra|saiba mais)\b/i.test(content)) return null;

    const body = bodyLines.join('\n').trim();
    if (!body || body.includes('#')) return null;

    const hashtags = this.buildHashtags(productName, brand, category);
    if (hashtags.length < 3 || hashtags.length > 4) return null;

    const final = [body, '@todos', hashtags.join('\n')].filter(Boolean).join('\n\n').trim();
    if ((final.match(/@todos\b/gi) || []).length !== 1) return null;
    if (/https?:\/\/|www\./i.test(final) || final.length > 500) return null;

    return final;
  }

  private validationReason(raw: string, productName: string, brand: string, category: string, sku: string): string {
    let content = String(raw || '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/\r/g, '').trim();
    if (!content) return 'empty';

    content = content.replace(/@todos\b/gi, '').replace(/#[\p{L}\p{N}_]+/gu, '').trim();
    if (/\b(?:r\$|rs\$|preço|preco|valor)\s*[:=-]?\s*\d/i.test(content)) return 'price';
    if (/\b(?:desconto|promoção|promocao|oferta\s+imperdível|imperdível|imperdivel|frete\s+grátis|frete\s+gratis|entrega\s+grátis|entrega\s+gratis)\b/i.test(content)) return 'promotion';
    if (content.length > 420) return 'too_long';

    const identityTokens = [productName, brand, category, sku].filter(Boolean);
    if (!identityTokens.some(v => content.toLowerCase().includes(v.toLowerCase()))) return 'identity_missing';

    const bodyLines = content.split('\n').map(line => line.trim()).filter(Boolean);
    const normalizedProductName = this.normalizeSearchText(productName);
    const firstLineNormalized = this.normalizeSearchText(bodyLines[0]?.replace(/^[🔧🛠️📌⭐📐⚙️]+\s*/, '') || '');
    if (firstLineNormalized === normalizedProductName || firstLineNormalized.startsWith(normalizedProductName)) return 'title_only';
    if (/^(?:categoria|sku|marca|produto)\s*:/i.test(bodyLines[0] || '')) return 'metadata_first_line';
    if (!/\b(?:confira|conheça|conheca|veja|descubra|saiba mais)\b/i.test(content)) return 'cta_missing';
    if (!this.buildHashtags(productName, brand, category).length) return 'hashtags_unavailable';

    return 'unknown';
  }

  private normalizeSearchText(value: string): string {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '')
      .toLowerCase();
  }

  private buildDeterministicCopy(productName: string, brand: string, category: string, _sku: string): string {
    const compactName = productName.replace(/\s+/g, ' ').trim();
    const categoryText = category ? ` na categoria ${category.toLowerCase()}` : '';
    const brandText = brand ? ` da ${brand}` : '';

    const body = `🛠️ A ${compactName}${brandText} é uma opção prática${categoryText}, com especificações claras para facilitar sua escolha.\n\n📌 Confira os detalhes e veja se este modelo atende ao seu trabalho.`;
    return [body, '@todos', this.buildHashtags(productName, brand, category).join('\n')].filter(Boolean).join('\n\n');
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
      'de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em', 'e', 'um', 'uma', 'por',
      'tipo', 'pol', 'mm', 'cm', 'm', 'v', 'w', 'entrega', 'frete', 'gratis', 'brasil',
      'a', 'o', 'as', 'os'
    ]);
    const significant = words.filter(
      word => word.length >= 3 && !stop.has(word.toLowerCase()) && !/^\d+(?:[.,]\d+)?$/.test(word)
    );

    const tags: string[] = [];
    const add = (value: string) => {
      const clean = value.replace(/[^a-zA-Z0-9]/g, '');
      if (!clean || clean.length < 3) return;
      const tag = '#' + clean;
      if (!tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    };

    // Product-specific semantic phrases are preferred over literal substring
    // checks. For example, "Furadeira Impacto" is a valid derived SEO tag even
    // when that exact concatenated string is not present in the product title.
    for (let i = 0; i < significant.length && tags.length < 2; i++) {
      const phrase = significant.slice(i, i + 2);
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

    if (category && tags.length < 4) {
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

    // These are domain-relevant fallbacks only when the product metadata does
    // not provide enough distinct semantic terms for the required 3-4 tags.
    if (tags.length < 4) add('Ferramentas');
    if (tags.length < 4) add('LojaDoMecanico');

    return tags.slice(0, 4);
  }

  private toTagWord(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
}

export const facebookCopyAgent = new FacebookCopyAgent();
