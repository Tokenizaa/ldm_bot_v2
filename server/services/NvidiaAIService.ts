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
  private readonly defaultModel = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-lightning-30b-a3b';
  private readonly fallbackModels = [
    'nvidia/nemotron-3-super-120b-a12b',
    'nvidia/nemotron-3-nano-30b-a3b',
    'nvidia/nvidia-nemotron-nano-9b-v2'
  ];

  isConfigured(): boolean {
    return Boolean(process.env.NVIDIA_API_KEY?.trim());
  }

  async generateRawCopy(systemPrompt: string, userPrompt: string, customModel?: string, attemptedModels: string[] = []): Promise<NvidiaGenerationResult> {
    const apiKey = process.env.NVIDIA_API_KEY?.trim();
    const model = customModel && customModel !== 'unknown'
      ? customModel
      : (process.env.NVIDIA_MODEL || this.defaultModel);

    if (!apiKey) {
      return { content: '', model, success: false, error: 'NVIDIA_API_KEY não configurada.' };
    }

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

      if (!response.ok) {
        const retryable = [400, 404, 408, 409, 410, 429, 500, 502, 503, 504].includes(response.status);
        const candidates = [this.defaultModel, ...this.fallbackModels]
          .filter(candidate => !attemptedModels.includes(candidate) && candidate !== model);

        if (retryable && candidates.length > 0) {
          const nextModel = candidates[0];
          logger.ai(`Modelo NVIDIA ${model} falhou (HTTP ${response.status}). Tentando Nemotron fallback ${nextModel}.`, 'warn');
          return this.generateRawCopy(systemPrompt, userPrompt, nextModel, [...attemptedModels, model]);
        }

        throw new Error(`NVIDIA API HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
      }

      const data = await response.json() as any;
      const content = String(data.choices?.[0]?.message?.content || '').trim();

      if (!content) {
        const retryCandidates = [this.defaultModel, ...this.fallbackModels]
        .filter(candidate => !attemptedModels.includes(candidate) && candidate !== model);

      if (retryCandidates.length > 0) {
        const nextModel = retryCandidates[0];
        logger.ai(`Modelo NVIDIA ${model} retornou conteúdo vazio. Tentando Nemotron fallback ${nextModel}.`, 'warn');
        return this.generateRawCopy(systemPrompt, userPrompt, nextModel, [...attemptedModels, model]);
      }

      throw new Error('NVIDIA API retornou uma resposta sem conteúdo após todos os modelos Nemotron.');
    
      }

      logger.ai(`Copy gerada pelo agente para "${userPrompt.split('\n')[0]}"`);
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

  async generateProductCopy(product: Product, affiliateUrl: string, customModel?: string): Promise<NvidiaGenerationResult> {
    if (!affiliateUrl.endsWith('/20889')) {
      return {
        content: '',
        model: customModel || process.env.NVIDIA_MODEL || this.defaultModel,
        success: false,
        error: 'URL de afiliado inválida: o sufixo /20889 é obrigatório.'
      };
    }

    const systemPrompt = [
      'Você é o agente oficial de copy SEO do ForgeDeals para grupos do Facebook no Brasil.',
      'Use exclusivamente os dados estruturados fornecidos.',
      'Não invente características, especificações, descontos, benefícios, avaliações, estoque, frete ou garantia.',
      'NUNCA escreva preço, valor, moeda ou URL.',
      'Crie uma copy comercial útil e interessante, não apenas um título.',
      'Inclua @todos exatamente uma vez.',
      'Use SEO natural e no máximo 4 hashtags relevantes.',
      'O link será inserido pelo publicador somente para gerar o preview Open Graph e não pertence à copy.',
      'Entregue somente a copy final.'
    ].join('\n');

    const userPrompt = [
      `Nome: ${product.product_name}`,
      `Marca: ${product.brand || 'não informada'}`,
      `Categoria: ${product.category || 'não informada'}`,
      `SKU: ${product.sku || 'não informado'}`
    ].join('\n');

    return this.generateRawCopy(systemPrompt, userPrompt, customModel);
  }
}

export const nvidiaAI = new NvidiaAIService();
