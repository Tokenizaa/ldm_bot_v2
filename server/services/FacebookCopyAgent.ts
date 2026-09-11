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
 * The LLM creates the SEO/commercial copy; the publisher owns the URL/preview.
 */
export class FacebookCopyAgent {
  async generate(product: Product, customModel?: string): Promise<FacebookCopyResult> {
    const model = customModel || process.env.NVIDIA_MODEL || undefined;

    if (!nvidiaAI.isConfigured()) {
      return {
        success: false,
        content: '',
        model,
        error: 'NVIDIA_API_KEY não configurada.'
      };
    }

    const systemPrompt = [
      'Você é o agente oficial de copy SEO do ForgeDeals para grupos do Facebook no Brasil.',
      '',
      'FONTE DE VERDADE:',
      'Use exclusivamente os dados estruturados do produto. Não invente características, especificações, descontos, benefícios, avaliações, estoque, frete, garantia ou qualquer fato.',
      '',
      'REGRAS ABSOLUTAS:',
      '- NUNCA escreva preço, valor, moeda, desconto percentual ou números que representem preço.',
      '- NUNCA escreva URL, domínio ou link.',
      '- Use o nome real do produto como núcleo da publicação.',
      '- Use marca, categoria e SKU quando ajudarem na busca e identificação.',
      '- Crie uma copy comercial útil e interessante, não apenas um título.',
      '- Faça SEO natural para busca interna do Facebook, sem keyword stuffing.',
      '- Inclua uma CTA para conferir a oferta/produto, mas sem link.',
      '- Inclua @todos exatamente uma vez, em linha própria.',
      '- Use no máximo 4 hashtags relevantes e derivadas do produto.',
      '- Não invente urgência, escassez, desconto ou benefício.',
      '- Entregue somente a copy final pronta para publicação.',
      '',
      'O link de afiliado será inserido separadamente pelo publicador apenas para gerar o preview Open Graph e depois poderá ser removido do texto. Ele NÃO pertence à copy.'
    ].join('\n');

    const userPrompt = [
      'Dados reais do produto:',
      'Nome: ' + product.product_name,
      'Marca: ' + (product.brand || 'não informada'),
      'Categoria: ' + (product.category || 'não informada'),
      'Código/SKU: ' + (product.sku || 'não informado')
    ].join('\n');

    const result = await nvidiaAI.generateRawCopy(systemPrompt, userPrompt, model);
    if (!result.success) {
      logger.ai('Falha no agente de copy para "' + product.product_name + '": ' + (result.error || 'erro desconhecido'), 'error');
      return result;
    }

    let content = result.content
      .replace(/https?:\/\/\S+|www\.\S+/gi, '')
      .replace(/\b(?:r\$|rs\$|preço|preco|valor)\s*[:=-]?\s*\d[\d\s.,]*/gi, '')
      .replace(/\b(?:por apenas|a partir de|por|de)\s+r\$?\s*\d[\d\s.,]*/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // Deterministic mandatory mention.
    content = content.replace(/@todos\b/gi, '').trim();
    content = content ? content + '\n\n@todos' : '@todos';

    const hasUrl = /https?:\/\/|www\./i.test(content);
    const hasPrice = /r\$\s*\d|\b(?:preço|preco|valor)\s*[:=-]?\s*\d|\b\d+[.,]\d{2}\s*(?:reais)?\b/i.test(content);
    const hasTodos = /@todos\b/i.test(content);

    if (hasUrl || hasPrice || !hasTodos) {
      logger.ai('Copy rejeitada após sanitização para "' + product.product_name + '".', 'error');
      return {
        ...result,
        success: false,
        content: '',
        error: 'Copy rejeitada após sanitização: preço/URL detectado ou @todos ausente.'
      };
    }

    return { ...result, content, success: true };
  }
}

export const facebookCopyAgent = new FacebookCopyAgent();
