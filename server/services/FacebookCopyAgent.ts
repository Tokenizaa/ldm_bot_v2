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
      const deterministic = this.buildDeterministicCopy(productName, brand, category, sku);
      return {
        success: true,
        content: deterministic,
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
      'Escreva uma copy comercial natural, curta e útil para busca no Facebook, com 3 a 5 frases.',
      'NÃO crie título, manchete, cabeçalho ou linha inicial apenas repetindo o nome do produto.',
      'NÃO escreva "Categoria:", "SKU:", "Marca:" ou qualquer outro rótulo de cadastro.',
      'O nome do produto é uma fonte de fatos técnicos. Transforme essas informações em texto de venda natural: explique o que é, para que tipo de tarefa ele serve quando isso estiver claramente indicado pelo nome, e destaque medidas, tensão, potência, quantidade de peças, tipo de teste ou outras especificações explicitamente presentes.',
      'A copy deve parecer escrita por uma pessoa para outro profissional/consumidor, e não por um catálogo. Use o nome e as especificações dentro das frases quando forem relevantes, sem simplesmente copiar o título.',
      'Inclua @todos exatamente uma vez em uma linha própria.',
      'Use de 4 a 6 hashtags SEO semanticamente derivadas do nome, marca ou categoria.',
      'Hashtags compostas são permitidas quando formadas por palavras existentes no produto, por exemplo #CaboDeVela a partir de "Cabo de Vela".',
      'Finalize com uma CTA factual para conhecer ou conferir o produto, sem prometer oferta, desconto ou preço.'
    ].join('\n');

    const userPrompt = [
      'DADOS DO PRODUTO — USE TODOS OS DADOS RELEVANTES; NÃO COPIAR ESTES RÓTULOS PARA A PUBLICAÇÃO',
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
      logger.ai('Modelo retornou copy inválida/contaminada; usando fallback determinístico.', 'warn');
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
      logger.ai(`COPY_VALIDATION_FAILED source=ensure-fallback product="${productName}" reason=${reason}`, 'error');
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

    const hashtags = content.match(/#[\p{L}\p{N}_]+/gu) || [];
    if (hashtags.length < 3 || hashtags.length > 6) return null;
    if (/\b(?:r\$|rs\$|preço|preco|valor)\s*[:=-]?\s*\d/i.test(content)) return null;
    if (/\b(?:desconto|promoção|promocao|oferta\s+imperdível|imperdível|imperdivel|frete\s+grátis|frete\s+gratis|entrega\s+grátis|entrega\s+gratis)\b/i.test(content)) return null;
    if (content.length > 650) return null;

    const identityTokens = [productName, brand, category, sku].filter(Boolean);
    if (!identityTokens.some(v => content.toLowerCase().includes(v.toLowerCase()))) return null;

    const bodyLines = content.split('\n').map(line => line.trim()).filter(Boolean);
    const normalizedProductName = this.normalizeSearchText(productName);
    const firstLineNormalized = this.normalizeSearchText(bodyLines[0]?.replace(/^[🔧🛠️📌⭐]+\s*/, '') || '');
    if (firstLineNormalized === normalizedProductName || firstLineNormalized.startsWith(normalizedProductName)) return null;
    if (/^(?:categoria|sku|marca|produto)\s*:/i.test(bodyLines[0] || '')) return null;

    const sourceNormalized = this.normalizeSearchText(identityTokens.join(' '));
    for (const tag of hashtags) {
      const token = this.normalizeSearchText(tag.slice(1));
      if (!token || !sourceNormalized.includes(token)) return null;
    }

    if (!/\b(?:confira|conheça|conheca|veja|descubra|saiba mais)\b/i.test(content)) return null;

    // Hashtags may be separated by newlines (the Facebook activation flow presses
    // Enter after every hashtag). Remove the trailing hashtag block regardless of
    // whether hashtags are one-per-line or grouped on the same line.
    const bodyLinesWithoutTags: string[] = [];
    for (const line of content.split('\n').map(line => line.trim()).filter(Boolean)) {
      if (/^(?:#[\p{L}\p{N}_]+\s*)+$/u.test(line)) continue;
      bodyLinesWithoutTags.push(line);
    }

    const body = bodyLinesWithoutTags.join('\n').trim();
    if (!body || body.includes('#')) return null;

    const final = [body, '@todos', hashtags.join('\n')].filter(Boolean).join('\n\n').trim();
    if ((final.match(/@todos\b/gi) || []).length !== 1) return null;
    if (/https?:\/\/|www\./i.test(final) || final.length > 700) return null;

    return final;
  }

  private validationReason(raw: string, productName: string, brand: string, category: string, sku: string): string {
    let content = String(raw || '').replace(/https?:\/\/\S+|www\.\S+/gi, '').replace(/\r/g, '').trim();
    if (!content) return 'empty';
    if (/\b(?:system prompt|user prompt|fonte de verdade|regras absolutas|dados reais do produto)\b/i.test(content)) return 'forbidden_meta';
    if (/(?:^|\n)\s*(?:nome|marca|categoria|sku|produto)\s*:/i.test(content)) return 'metadata_label';
    const hashtags = content.match(/#[\p{L}\p{N}_]+/gu) || [];
    if (hashtags.length < 3 || hashtags.length > 6) return `hashtag_count_${hashtags.length}`;
    if (/\b(?:r\$|rs\$|preço|preco|valor)\s*[:=-]?\s*\d/i.test(content)) return 'price';
    if (/\b(?:desconto|promoção|promocao|oferta\s+imperdível|imperdível|imperdivel|frete\s+grátis|frete\s+gratis|entrega\s+grátis|entrega\s+gratis)\b/i.test(content)) return 'promotion';
    if (content.length > 650) return 'too_long';
    const identityTokens = [productName, brand, category, sku].filter(Boolean);
    if (!identityTokens.some(v => content.toLowerCase().includes(v.toLowerCase()))) return 'identity_missing';
    const bodyLines = content.replace(/@todos\b/gi, '').split('\n').map(line => line.trim()).filter(Boolean);
    const normalizedProductName = this.normalizeSearchText(productName);
    const firstLineNormalized = this.normalizeSearchText(bodyLines[0]?.replace(/^[🔧🛠️📌⭐]+\s*/, '') || '');
    if (firstLineNormalized === normalizedProductName || firstLineNormalized.startsWith(normalizedProductName)) return 'title_only';
    if (/^(?:categoria|sku|marca|produto)\s*:/i.test(bodyLines[0] || '')) return 'metadata_first_line';
    const sourceNormalized = this.normalizeSearchText(identityTokens.join(' '));
    for (const tag of hashtags) {
      const token = this.normalizeSearchText(tag.slice(1));
      if (!token || !sourceNormalized.includes(token)) return `hashtag_not_derived:${tag}`;
    }
    if (!/\b(?:confira|conheça|conheca|veja|descubra|saiba mais)\b/i.test(content)) return 'cta_missing';
    const body = content.split('\n').map(line => line.trim()).filter(Boolean).filter(line => !/^(?:#[\p{L}\p{N}_]+\s*)+$/u.test(line)).join('\n').trim();
    if (!body || body.includes('#')) return 'hashtags_inside_body';
    return 'unknown';
  }

  private normalizeSearchText(value: string): string {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
  }

  private buildDeterministicCopy(productName: string, brand: string, category: string, _sku: string): string {
    const searchPhrase = this.semanticSearchPhrase(productName);
    const brandPhrase = brand ? ' Da marca ' + brand + ',' : '';
    const categoryPhrase = category ? ' dentro da linha de ' + category.toLowerCase() : '';

    const sentences = [
      searchPhrase
        ? 'Se você procura uma solução para ' + searchPhrase.toLowerCase() + ', esta opção atende a essa necessidade com as especificações informadas pelo fabricante.'
        : 'Uma opção prática para quem busca uma ferramenta com as especificações apresentadas no produto.',
      brand
        ? 'O ' + productName + brandPhrase + ' reúne no próprio modelo as características que ajudam na escolha da ferramenta certa' + categoryPhrase + '.'
        : 'O modelo ' + productName + ' reúne as características técnicas apresentadas no anúncio para facilitar a escolha da ferramenta certa.',
      'Confira os detalhes e especificações do produto antes de escolher.'
    ];

    return [sentences.join(' '), '@todos', this.buildHashtags(productName, brand, category).join('\n')].filter(Boolean).join('\n\n');
  }

  private semanticSearchPhrase(productName: string): string {
    const words = productName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
    const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em', 'e', 'um', 'uma', 'por']);
    const useful = words.filter(w => w.length >= 3 && !stop.has(w.toLowerCase()));
    return useful.slice(0, 5).join(' ');
  }

  private buildHashtags(productName: string, brand: string, category: string): string[] {
    const source = [productName, brand, category].filter(Boolean).join(' ');
    const words = source.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
    const stop = new Set(['de', 'da', 'do', 'das', 'dos', 'para', 'com', 'em', 'e', 'um', 'uma', 'por', 'tipo', 'pol', 'mm', 'cm', 'm', 'v', 'w', 'entrega', 'frete', 'gratis', 'brasil', 'a', 'o', 'as', 'os']);
    const significant = words.filter(word => word.length >= 3 && !stop.has(word.toLowerCase()) && !/^\d+(?:[.,]\d+)?$/.test(word));

    const tags: string[] = [];
    const add = (value: string) => {
      if (!value) return;
      const tag = '#' + value;
      if (!tags.some(existing => existing.toLowerCase() === tag.toLowerCase())) tags.push(tag);
    };

    for (let i = 0; i < significant.length && tags.length < 3; i++) {
      const phrase = significant.slice(i, i + 2);
      if (phrase.length >= 2) add(phrase.map(this.toTagWord).join(''));
    }

    if (brand) {
      const brandWords = brand.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
      add(brandWords.map(this.toTagWord).join(''));
    }

    if (category) {
      const categoryWords = category.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, ' ').split(/\s+/).filter(Boolean);
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
