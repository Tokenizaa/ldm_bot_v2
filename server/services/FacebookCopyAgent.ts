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
 * Canonical copy agent for Facebook product posts.
 *
 * The agent does NOT publish and does NOT add the affiliate URL.
 * The publisher handles the URL separately so Facebook can build the
 * Open Graph preview and then remove the raw URL from the final text.
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

OBJETIVO:
Criar uma copy comercial interessante, natural e otimizada para descoberta/SEO interno do Facebook, sem parecer spam.

FONTE DE VERDADE:
Use EXCLUSIVAMENTE os dados estruturados do produto fornecidos pelo sistema.
Você pode reorganizar, combinar e destacar palavras-chave que já estejam nos dados.
NUNCA invente características, especificações, descontos, benefícios, avaliações, estoque, frete, garantia ou qualquer outra informação não fornecida.

REGRAS OBRIGATÓRIAS:
1. NUNCA escreva preço ou moeda.
2. NUNCA escreva URL, link ou chamada contendo URL.
3. NUNCA escreva código promocional inexistente.
4. Não use "preço", "R$" ou equivalentes.
5. Use o nome real do produto como núcleo semântico.
6. Aproveite marca, categoria e SKU quando forem úteis.
7. Gere texto com intenção comercial clara e palavras-chave naturais.
8. O texto deve despertar interesse e incentivar a pessoa a conferir a oferta.
9. Evite títulos genéricos como apenas "OFERTA".
10. Não use afirmações absolutas que não estejam nos dados.
11. Inclua @todos em uma linha própria no final da copy.
12. Inclua no máximo 4 hashtags relevantes, derivadas do produto/categoria.
13. Entregue SOMENTE o texto final pronto para o Facebook.
14. Não explique as regras nem mencione IA.

ESTRUTURA PREFERENCIAL:
- Gancho curto e relevante.
- Nome do produto / principal intenção de busca.
- Contexto comercial baseado nos dados reais.
- Código somente se ajudar na identificação.
- CTA para conferir a oferta, sem URL.
- @todos.
- Hashtags.

IMPORTANTE:
O link de afiliado será inserido separadamente pelo publicador para gerar o preview Open Graph. Ele NÃO faz parte da copy gerada.
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

    const forbiddenPrice = /R\\$|\\bpreço\\b|\\bpor apenas\\b|\\bpor R\\$/i.test(result.content);
    if (forbiddenPrice || /https?:\\/\\//i.test(result.content)) {
      return {
        ...result,
        success: false,
        content: '',
        error: 'Copy rejeitada: contém preço ou URL, que são proibidos na descrição.'
      };
    }

    return result;
  }
}
