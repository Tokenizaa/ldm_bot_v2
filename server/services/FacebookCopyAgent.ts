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
 *
 * Important: the AI is optional. The final publication is always normalized
 * and validated locally. If the model returns reasoning/meta text, we do not
 * retry indefinitely or publish it: we build a deterministic copy from the
 * structured product fields instead.
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
      'Crie uma publicação curta para um grupo brasileiro do Facebook.',
      'Retorne SOMENTE o texto final da publicação. Não explique nada.',
      'Use apenas os campos do produto fornecidos pelo usuário.',
      'Não invente características, especificações, benefícios, avaliações, estoque, frete, garantia, desconto ou urgência.',
      'Não escreva preço, moeda ou URL.',
      'Não repita selos ou textos comerciais que estejam misturados no nome, como Entrega, Frete Grátis ou avaliações.',
      'Inclua uma CTA simples para conferir o produto.',
      'Inclua @todos exatamente uma vez em uma linha própria.',
      'Use no máximo 4 hashtags, derivadas apenas do nome, marca e categoria.',
      'O link será adicionado separadamente pelo publicador.',
      'Não use rótulos como Copy:, Dados:, Nome:, Marca:, Categoria:, SKU: ou hashtags de exemplo.'
    ].join('\n');

    const userPrompt = [
      'PRODUTO',
      'Nome: ' + productName,
      'Marca: ' + (brand || 'não informada'),
      'Categoria: ' + (category || 'não informada'),
      'SKU: ' + (sku || 'não informado')
    ].join('\n');

    const first = await nvidiaAI.generateRawCopy(systemPrompt, userPrompt, model);
    if (first.success) {
      const normalized = this.normalizeAndValidate(first.content, productName, brand, category, sku);
      if (normalized) {
        return { ...first, success: true, content: normalized };
      }

      logger.ai('Modelo retornou copy inválida/contaminada; usando fallback determinístico.', 'warn');
    }

    // One controlled AI failure is enough. Do not spend more tokens regenerating
    // the same polluted answer; the deterministic path cannot leak model prose.
    const deterministic = this.buildDeterministicCopy(productName, brand, category, sku);
    return {
      success: true,
      content: deterministic,
      model: first.model || model || 'deterministic',
      tokensUsed: first.tokensUsed,
      error: first.success ? undefined : first.error
    };
  }

  /**
   * Removes merchandising suffixes scraped from product titles while preserving
   * real product identity and technical specifications.
   */
  private cleanProductName(value: string): string {
    let name = this.cleanField(value) || 'Produto';

    // Scraped commerce titles commonly end with these non-product decorations:
    // "Entrega 4.9", "Entrega Frete Grátis ... 4.9", etc.
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

  /**
   * Normalizes an AI response into the only format that may reach Facebook.
   * Returning null causes the deterministic fallback.
   */
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

    // Hard reject model-analysis/meta output. Do not try to surgically publish
    // an answer whose semantic boundaries are uncertain.
    const forbiddenMeta = [
      /\b(?:system prompt|user prompt|fonte de verdade|regras absolutas|dados reais do produto)\b/i,
      /\b(?:we need to|let'?s craft|let'?s place|check:|however,|actually,|we need to ensure|the name includes)\b/i,
      /\b(?:vamos criar|vamos montar|precisamos garantir|verifique:)\b/i,
      /(?:^|\n)\s*(?:copy|análise|analise|explicação|explicacao|raciocínio|raciocinio)\s*:/i,
      /(?:^|\n)\s*(?:nome|marca|categoria|sku|produto)\s*:/i,
      /\b(?:instrução|instrucao|modelo deve|resposta do modelo)\b/i
    ];

    if (forbiddenMeta.some(re => re.test(content))) return null;

    // Remove accidental markdown wrappers, but never rewrite arbitrary prose.
    content = content
      .replace(/^\s*[`"]{1,3}/, '')
      .replace(/[`"]{1,3}\s*$/g, '')
      .trim();

    // The model must not be trusted to place @todos correctly.
    content = content.replace(/@todos\b/gi, '').trim();
    if (!content) return null;

    const hashtags = content.match(/#\w+/g) || [];
    if (hashtags.length > 4) return null;
    if (/\b(?:r\$|rs\$|preço|preco|valor)\s*[:=-]?\s*\d/i.test(content)) return null;
    if (/\b(?:desconto|promoção|promocao|oferta\s+imperdível|imperdível|imperdivel|frete\s+grátis|frete\s+gratis|entrega\s+grátis|entrega\s+gratis)\b/i.test(content)) return null;
    if (content.length > 650) return null;

    // The output must contain a product identity, a CTA and exactly one mention.
    const identityTokens = [productName, brand, category, sku].filter(Boolean);
    if (!identityTokens.some(v => content.toLowerCase().includes(v.toLowerCase()))) return null;

    const cta = /\b(?:confira|conheça|conheca|veja|descubra|saiba mais)\b/i.test(content);
    if (!cta) return null;

    const hashtagText = hashtags.join(' ');
    const body = content.replace(/(?:^|\n)\s*#\w+(?:\s+#\w+)*\s*$/i, '').trim();
    const final = [body, '@todos', hashtagText].filter(Boolean).join('\n\n').trim();

    const todosCount = (final.match(/@todos\b/gi) || []).length;
    if (todosCount !== 1 || /https?:\/\/|www\./i.test(final) || final.length > 700) return null;

    return final;
  }

  /**
   * Guaranteed-safe fallback. It uses no AI-generated claims.
   */
  private buildDeterministicCopy(
    productName: string,
    brand: string,
    category: string,
    sku: string
  ): string {
    const identity = [productName, brand].filter(Boolean).join(' — ');
    const categoryText = category ? ' | Categoria: ' + category : '';
    const skuText = sku ? ' | SKU: ' + sku : '';

    const hashtags = this.buildHashtags(productName, brand, category);
    return [
      '🔧 ' + identity,
      categoryText || skuText ? (categoryText + skuText).trim() : '',
      'Confira este produto e veja todos os detalhes da oferta.',
      '@todos',
      hashtags.join(' ')
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
      'um', 'uma', 'por', 'tipo', 'pol', 'mm', 'cm', 'v', 'w',
      'entrega', 'frete', 'gratis', 'brasil'
    ]);

    const candidates: string[] = [];
    for (const word of words) {
      if (stop.has(word.toLowerCase()) || word.length < 3) continue;
      if (/^\d+(?:[.,]\d+)?$/.test(word)) continue;
      const tag = '#' + word.replace(/^./, c => c.toUpperCase());
      if (!candidates.some(x => x.toLowerCase() === tag.toLowerCase())) candidates.push(tag);
      if (candidates.length === 4) break;
    }

    return candidates.length ? candidates : ['#Ferramentas'];
  }
}

export const facebookCopyAgent = new FacebookCopyAgent();
