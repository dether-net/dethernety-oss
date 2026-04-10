import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly enabled: boolean;
  private readonly url: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly dimensions: number;
  private readonly threshold: number;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.configService.get('EMBEDDING_ENABLED') === 'true';
    this.url = this.configService.get('EMBEDDING_URL') || 'http://localhost:11434/api/embed';
    this.apiKey = this.configService.get('EMBEDDING_API_KEY') || '';
    this.model = this.configService.get('EMBEDDING_MODEL') || 'nomic-embed-text';
    this.dimensions = parseInt(this.configService.get('EMBEDDING_DIMENSIONS') || '768', 10);
    this.threshold = parseFloat(this.configService.get('EMBEDDING_SIMILARITY_THRESHOLD') || '0.75');

    this.logger.log('EmbeddingService initialized', {
      enabled: this.enabled,
      model: this.model,
      dimensions: this.dimensions,
      threshold: this.threshold,
      url: this.enabled ? this.url : '(disabled)',
    });
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getModel(): string {
    return this.model;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getThreshold(): number {
    return this.threshold;
  }

  /**
   * Embed a batch of texts via the configured HTTP endpoint.
   * Returns null if embeddings are disabled.
   * Retries up to 3 times with exponential backoff (1s, 3s, 9s) on failure.
   * Throws after all retries are exhausted.
   */
  async embedBatch(texts: string[]): Promise<number[][] | null> {
    if (!this.enabled) return null;

    const maxRetries = 3;
    const backoffBase = 1000; // 1s, 3s, 9s

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(this.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ model: this.model, input: texts }),
        });
        if (!response.ok) {
          throw new Error(`Embedding API returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        return this.parseEmbeddingResponse(data, texts.length);
      } catch (error) {
        if (attempt === maxRetries) throw error;
        const delay = backoffBase * Math.pow(3, attempt - 1);
        this.logger.warn(
          `Embedding attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`,
          { error: error instanceof Error ? error.message : String(error) },
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    // Unreachable — loop either returns or throws on final attempt
    return null;
  }

  /**
   * Parse the embedding response, supporting both OpenAI and Ollama formats.
   *
   * OpenAI format: { data: [{ embedding: [...] }, ...] }
   * Ollama /api/embed: { embeddings: [[...], [...]] }
   * Ollama /api/embeddings (single): { embedding: [...] }
   */
  private parseEmbeddingResponse(data: any, expectedCount: number): number[][] {
    // OpenAI format: { data: [{ embedding: [...] }] }
    if (Array.isArray(data?.data)) {
      return data.data.map((item: any) => item.embedding);
    }

    // Ollama /api/embed format: { embeddings: [[...], [...]] }
    if (Array.isArray(data?.embeddings)) {
      return data.embeddings;
    }

    // Ollama /api/embeddings single-text format: { embedding: [...] }
    if (Array.isArray(data?.embedding)) {
      return [data.embedding];
    }

    throw new Error(
      `Unexpected embedding API response format. Expected OpenAI ({ data: [...] }) or Ollama ({ embeddings: [...] }) format, got keys: [${Object.keys(data || {}).join(', ')}]`,
    );
  }

  /**
   * Compose the embedding text for a class node.
   */
  composeClassText(cls: {
    name: string;
    description?: string;
    category?: string;
    type?: string;
  }): string {
    return `${cls.name}. ${cls.description || ''}. Category: ${cls.category || 'General'}. Type: ${cls.type || 'Unknown'}.`;
  }

  /**
   * Compose the embedding text for a query element.
   */
  composeElementText(element: {
    name: string;
    description?: string;
    type?: string;
  }): string {
    return `${element.name}. ${element.description || ''}. Type: ${element.type || 'Unknown'}.`;
  }
}
