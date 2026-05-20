import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  composeClassText,
  composeElementText,
  composeTechniqueText,
  composeMitigationText,
  parseEmbeddingResponse,
} from '@dethernety/dt-module/embedding';

/**
 * L2-normalize a single embedding vector to unit length. Used so runtime
 * query vectors carry the same magnitude as the build-time stored vectors
 * (mitre-frameworks/scripts/embedding_provider.py normalizes on emit). This
 * keeps cosine-similarity scores well-defined and bounded in [-1, 1] modulo
 * FP noise, regardless of whether the embedding endpoint (Ollama / OpenAI)
 * happens to return normalized vectors by default.
 */
function l2NormalizeBatch(vectors: number[][]): number[][] {
  return vectors.map((v) => {
    let sumSq = 0;
    for (let i = 0; i < v.length; i++) sumSq += v[i] * v[i];
    if (sumSq === 0) return v;
    const inv = 1 / Math.sqrt(sumSq);
    const out = new Array<number>(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
    return out;
  });
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  /**
   * Session-level enabled flag. Starts from EMBEDDING_ENABLED and can be
   * flipped to false by disableForSession() — for example when
   * MatchClassesResolverService detects an index-dimension mismatch. Callers
   * read isEnabled() before every resolve pass; the flag is never flipped
   * back on within a process lifetime.
   */
  private enabled: boolean;
  private sessionDisabled = false;
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
   * Disable embedding for the remainder of this process. Called when the
   * runtime detects an unrecoverable invariant break (most notably, a
   * vector-index dimension that disagrees with EMBEDDING_DIMENSIONS).
   *
   * After this is called, isEnabled() returns false and embedBatch()
   * returns null. Logs exactly once.
   */
  disableForSession(reason: string): void {
    if (this.sessionDisabled) return;
    this.sessionDisabled = true;
    this.enabled = false;
    this.logger.error('Embedding disabled for this session', { reason });
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
        const parsed = parseEmbeddingResponse(data, texts.length);
        // L2-normalize to match the build-side unit-vector contract
        // (mitre-frameworks/scripts/embedding_provider.py). Idempotent on
        // already-unit vectors.
        return parsed ? l2NormalizeBatch(parsed) : parsed;
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
   * Compose the embedding text for a class node. Delegates to the shared
   * helper so runtime and build-time tooling produce identical text.
   */
  composeClassText(cls: {
    name: string;
    description?: string;
    category?: string;
    type?: string;
  }): string {
    return composeClassText(cls);
  }

  /**
   * Compose the embedding text for a query element (match_classes input side).
   */
  composeElementText(element: {
    name: string;
    description?: string;
    type?: string;
  }): string {
    return composeElementText(element);
  }

  /**
   * Compose the embedding text for a MITRE technique (ATT&CK or D3FEND).
   * Delegates to the dt-module helper so runtime and build-time
   * tooling produce byte-equal text.
   */
  composeTechniqueText(t: {
    name: string;
    description?: string;
    tactic?: string;
  }): string {
    return composeTechniqueText(t);
  }

  /**
   * Compose the embedding text for a MITRE mitigation. Same byte-equality
   * contract as composeTechniqueText.
   */
  composeMitigationText(m: { name: string; description?: string }): string {
    return composeMitigationText(m);
  }
}
