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
 * Canonical Facebook copy agent.
 * Generates only the human-facing copy; the publisher owns the affiliate URL.
 */
export class FacebookCopyAgent {
  async generate(product: Product, customModel?: string): Promise<FacebookCopyResult> {
    if (!nvidiaAI.isConfigured()) {
      return {
        success: false,
        content: '',
        model: customModel || process.env.NVIDIA_MODEL || 'unknown',
        error: 'NVIDIA_API_KEY não configurada.'
      };
    }

    const model = customModel || process.env.NVIDIA_MODEL;
    const systemPrompt = `
Você é o agente oficial de copy e SEO do ForgeDeals para publicações de produtos em grupos do Facebook no Brasil.

FONTE DE VERDADE:
Use exclusivamente os dados estruturados fornecidos. Não invente características, especificações, descontos, benefícios, avaliações, estoque, frete, garantia ou qualquer outra informação.

REGRAS OBRIGATÓRIAS:
1. Nunca escreva preço, valor, moeda ou qualquer expressão equivalente.
2. Nunca escreva URL ou link.
3. Use o nome real do produto como núcleo semântico.
4. Aproveite marca, categoria e SKU quando forem úteis.
5. Crie uma copy comercial natural, interessante e otimizada para descoberta/SEO interno do Facebook.
6. Não reduza a publicação a um simples título.
7. Inclua uma CTA natural para conferir a oferta, sem URL.
8. Inclua @todos em uma linha própria no final.
9. Inclua no máximo 4 hashtags relevantes, derivadas dos dados do produto.
10. Não faça afirmações que não possam ser sustentadas pelos dados fornecidos.
11. Entregue somente o texto final pronto para publicação.

ESTRUTURA:
- Gancho curto.
- Nome do produto e termos relevantes de busca.
- Contexto comercial baseado nos dados reais.
- Código/SKU se ajudar na identificação.
- CTA sem URL.
- @todos.
- Hashtags.

O link de afiliado será inserido pelo publicador separadamente para gerar o preview Open Graph e não faz parte da copy.
`.trim();

    const userPrompt = [
      `Produto: ${product.product_name}`,
      `Marca: ${product.brand || 'não informada'}`,
      `Categoria: ${product.category || 'não informada'}`,
      `Código/SKU: ${product.sku || 'não informado'}`
    ].join('\\n');

    const result = await nvidiaAI.generateRawCopy(systemPrompt, userPrompt, model);
    if (!result.success) {
      logger.ai(`Falha no agente de copy para "${product.product_name}": ${result.error}`, 'error');
      return result;
    }

    // Publication rules are enforced in code as a final safety layer.
    let content = result.content
      .replace(/https?:\\/\\/\\S+|www\\.\\S+/gi, '')
      .replace(/R\\$\\s*\\d[\\d.]*(?:,\\d{1,2})?/gi, '')
      .replace(/^[ \\t]*(?:preço|valor)\\s*:?[ \\t]*.*$/gim, '')
      .replace(/[ \\t]{2,}/g, ' ')
      .replace(/\\n{3,}/g, '\\n\\n')
      .trim();

    // @todos is mandatory and deterministic; never depend on the model for it.
    if (!/@todos\\b/i.test(content)) {
      content = `${content}\\n\\n@todos`;
    }

    const hasUrl = /https?:\\/\\/|www\\./i.test(content);
    const hasMoney = /R\\$\\s*\\d|\\b\\d+[.,]\\d{2}\\s*(?:reais)?\\b/i.test(content);
    if (hasUrl || hasMoney || !/@todos\\b/i.test(content)) {
      logger.ai(`Copy rejeitada após sanitização para "${product.product_name}".`, 'error');
      return {
        ...result,
        success: false,
        content: '',
        error: 'Copy rejeitada após sanitização: não pode conter preço/URL e deve conter @todos.'
      };
    }

    return { ...result, content, success: true };
    }

    const forbiddenPrice = /R\$|\bpreço\b|\bvalor\b|\bpor apenas\b|\bpor R\$/i.test(result.content);
    const forbiddenUrl = /https?:\/\/|www\./i.test(result.content);
    const missingTodos = !/@todos\b/i.test(result.content);

    if (forbiddenPrice || forbiddenUrl || missingTodos) {
      return {
        ...result,
        success: false,
        content: '',
        error: 'Copy rejeitada: contém preço/URL ou não contém @todos.'
      };
    }

    return result;
  }
}

export const facebookCopyAgent = new FacebookCopyAgent();
