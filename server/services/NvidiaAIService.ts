import { Product } from '../types.js';
import { logger } from './LoggerService.js';

export interface NvidiaGenerationResult {
  content: string;
  model: string;
  tokensUsed?: number;
  success: boolean;
  error?: string;
}

export class NvidiaAIService {
  private apiUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
  private defaultModel = 'meta/llama-3.1-70b-instruct';

  private getApiKey(): string | undefined {
    return process.env.NVIDIA_API_KEY;
  }

  isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(key && key.trim().length > 0);
  }

  async generateProductCopy(product: Product, affiliateUrl: string, customModel?: string): Promise<NvidiaGenerationResult> {
    const model = customModel || process.env.NVIDIA_MODEL || this.defaultModel;
    const apiKey = this.getApiKey();

    logger.ai(`Generating content for product "${product.product_name}" using NVIDIA AI (${model})`);

    // Price formatting helpers
    const currentPriceFormatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.current_price);
    const previousPriceFormatted = product.previous_price && product.previous_price > product.current_price
      ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(product.previous_price)
      : null;

    if (!apiKey) {
      logger.ai('NVIDIA_API_KEY is not defined in environment. Using high-conversion commercial template fallback.', 'warn');
      const fallbackContent = this.generateDirectCopy(product, affiliateUrl, currentPriceFormatted, previousPriceFormatted);
      return {
        content: fallbackContent,
        model: 'template-fallback',
        success: true
      };
    }

    const systemPrompt = `Você é um copywriter de elite especializado em ofertas automotivas, ferramentas e mecânica para grupos do Facebook no Brasil.
Suas publicações são diretas, comerciais, persuasivas e com alta taxa de clique.
REGRAS RÍGIDAS:
1. NUNCA invente características, marcas, garantias, avaliações ou descontos falsos.
2. Utilize EXATAMENTE os preços e dados fornecidos.
3. O link final DEVE ser OBRIGATORIAMENTE o link de afiliado fornecido: ${affiliateUrl}
4. Não utilize linguagem de vendas genérica ou clichês corporativos vazios.
5. Mantenha a publicação concisa (máximo 4 a 6 linhas), com emojis adequados e chamada clara para ação.
6. A saída deve ser APENAS o texto pronto para publicação no Facebook.`;

    const userPrompt = `Gere uma publicação para o Facebook Group para este produto:
Nome: ${product.product_name}
Marca: ${product.brand || 'Consulte no link'}
Categoria: ${product.category || 'Ferramentas'}
Preço Atual: ${currentPriceFormatted}
${previousPriceFormatted ? `Preço Anterior: ${previousPriceFormatted}` : ''}
Link Oficial de Compra (Afiliado): ${affiliateUrl}

Gere o post agora:`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.5,
          max_tokens: 400
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`NVIDIA API HTTP ${response.status}: ${errText.slice(0, 150)}`);
      }

      const data = await response.json();
      let generatedText = data.choices?.[0]?.message?.content?.trim() || '';

      // Validate that the generated text contains the affiliate link
      if (!generatedText.includes(affiliateUrl)) {
        generatedText += `\n\n👉 Garanta já a sua aqui: ${affiliateUrl}`;
      }

      logger.ai(`Content generated successfully for product "${product.product_name}"`);

      return {
        content: generatedText,
        model,
        tokensUsed: data.usage?.total_tokens,
        success: true
      };
    } catch (err: any) {
      logger.ai(`NVIDIA AI API error: ${err.message}. Engaging structured commercial fallback.`, 'error');
      const fallbackContent = this.generateDirectCopy(product, affiliateUrl, currentPriceFormatted, previousPriceFormatted);
      return {
        content: fallbackContent,
        model: 'template-fallback',
        success: true,
        error: err.message
      };
    }
  }

  private generateDirectCopy(
    product: Product,
    affiliateUrl: string,
    currentPriceFormatted: string,
    previousPriceFormatted: string | null
  ): string {
    const brandInfo = product.brand ? ` [${product.brand}]` : '';
    const discountLine = previousPriceFormatted
      ? `💥 De ${previousPriceFormatted} por apenas ${currentPriceFormatted} à vista!`
      : `💥 Por apenas ${currentPriceFormatted} à vista!`;

    return `🔥 OFERTA DO DIA NA LOJA DO MECÂNICO!

⚡ ${product.product_name}${brandInfo}
${discountLine}

🛠️ Equipamento de alta qualidade para sua oficina ou trabalho profissional.
🚚 Aproveite enquanto durar o estoque!

👉 Confira os detalhes e compre com desconto exclusivo:
${affiliateUrl}`;
  }
}

export const nvidiaAI = new NvidiaAIService();
