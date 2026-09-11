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
  private readonly apiUrl = 'https://integrate.api.nvidia.com/v1/chat/completions';
  private readonly defaultModel = process.env.NVIDIA_MODEL || 'meta/llama-3.2-11b-vision-instruct';
  private readonly activeFallbackModel = 'meta/llama-3.2-11b-vision-instruct';

  isConfigured(): boolean {
    return Boolean(process.env.NVIDIA_API_KEY?.trim());
  }

  async generateRawCopy(systemPrompt: string, userPrompt: string, customModel?: string): Promise<NvidiaGenerationResult> {
    const apiKey = process.env.NVIDIA_API_KEY?.trim();
    const model = customModel || process.env.NVIDIA_MODEL || this.defaultModel;

    if (!apiKey) return { content: '', model, success: false, error: 'NVIDIA_API_KEY não configurada.' };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.75,
          max_tokens: 500
        })
      });

      if (!response.ok) throw new Error(`NVIDIA API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);

      const data = await response.json() as any;
      const content = String(data.choices?.[0]?.message?.content || '').trim();
      if (!content) throw new Error('NVIDIA API retornou uma resposta sem conteúdo.');

      logger.ai(`Copy gerada pelo agente para "${userPrompt.split('\\n')[0]}"`);
      return { content, model, tokensUsed: data.usage?.total_tokens, success: true };
    } catch (err: any) {
      logger.ai(`Falha NVIDIA: ${err.message}`, 'error');
      return { content: '', model, success: false, error: err.message };
    }
  }

  async generateProductCopy(product: Product, affiliateUrl: string, customModel?: string): Promise<NvidiaGenerationResult> {
    const apiKey = process.env.NVIDIA_API_KEY?.trim();
    let model = customModel || process.env.NVIDIA_MODEL || this.defaultModel;

    if (!apiKey) {
      const error = 'NVIDIA_API_KEY não configurada. A geração de copy não pode continuar.';
      logger.ai(error, 'error');
      return { content: '', model, success: false, error };
    }

    if (!affiliateUrl.endsWith('/20889')) {
      const error = 'URL de afiliado inválida: o sufixo /20889 é obrigatório.';
      logger.ai(error, 'error');
      return { content: '', model, success: false, error };
    }

    const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
    const currentPrice = currency.format(product.current_price);
    const previousPrice = product.previous_price && product.previous_price > product.current_price
      ? currency.format(product.previous_price)
      : null;

    const systemPrompt = `Você é um copywriter comercial para grupos do Facebook no Brasil.\nREGRAS: use somente os dados fornecidos; não invente desconto, estoque, garantia, avaliação, característica ou benefício; preserve exatamente o preço atual; o único link permitido é o afiliado fornecido; entregue apenas o texto pronto para publicação, com no máximo 6 linhas.`;
    const userPrompt = `Produto: ${product.product_name}\nMarca: ${product.brand || 'não informada'}\nCategoria: ${product.category || 'não informada'}\nPreço atual: ${currentPrice}${previousPrice ? `\nPreço anterior: ${previousPrice}` : ''}\nLink afiliado obrigatório: ${affiliateUrl}`;

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
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
        if (response.status === 410 && model !== this.activeFallbackModel) {
          logger.ai(`Modelo ${model} descontinuado pela NVIDIA (HTTP 410). Redirecionando automaticamente para ${this.activeFallbackModel}...`, 'warn');
          return this.generateProductCopy(product, affiliateUrl, this.activeFallbackModel);
        }
        const text = await response.text();
        throw new Error(`NVIDIA API HTTP ${response.status}: ${text.slice(0, 300)}`);
      }

      const data = await response.json() as any;
      const content = String(data.choices?.[0]?.message?.content || '').trim();

      if (!content) {
        throw new Error('NVIDIA API retornou uma resposta sem conteúdo.');
      }

      if (!content.includes(affiliateUrl)) {
        throw new Error('A NVIDIA não retornou o link afiliado obrigatório; publicação bloqueada.');
      }

      logger.ai(`Copy NVIDIA gerada para "${product.product_name}"`);
      return {
        content,
        model,
        tokensUsed: data.usage?.total_tokens,
        success: true
      };
    } catch (err: any) {
      logger.ai(`Falha NVIDIA: ${err.message}`, 'error');
      return { content: '', model, success: false, error: err.message };
    }
  }
}

export const nvidiaAI = new NvidiaAIService();
