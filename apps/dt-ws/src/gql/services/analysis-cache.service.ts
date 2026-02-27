/**
 * Analysis Cache Service
 * 
 * Specialized caching service for analysis metadata from Neo4j database operations.
 * IMPORTANT: Only caches database queries, never module responses (modules provide real-time data).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { 
  AnalysisMetadata, 
  AnalysisMetadataCacheEntry, 
  AnalysisCacheStatistics,
  AnalysisResolverConfig 
} from '../interfaces/analysis-resolver.interface';
import { GqlConfig } from '../gql.config';

@Injectable()
export class AnalysisCacheService {
  private readonly logger = new Logger(AnalysisCacheService.name);
  private readonly cache = new Map<string, AnalysisMetadataCacheEntry>();
  private readonly config: AnalysisResolverConfig;
  private cleanupInterval: NodeJS.Timeout;
  private statistics = {
    hits: 0,
    misses: 0,
    evictions: 0,
    totalOperations: 0,
  };

  constructor(private readonly configService: ConfigService) {
    const gqlConfig = this.configService.get<GqlConfig>('gql')!;
    
    // Analysis-specific cache configuration
    this.config = {
      cacheEnabled: true,
      cacheTtl: 5 * 60 * 1000, // 5 minutes for metadata
      maxCacheSize: 1000, // Max cached analysis metadata entries
      maxParallelAnalyses: 50,
      cleanupInterval: 60 * 1000, // 1 minute cleanup
      maxSubscriptionsPerUser: 10,
      subscriptionCleanupInterval: 30 * 1000, // 30 seconds
      enableDetailedMetrics: true,
      metricsRetentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
      pubSubMaxListeners: 100,
      pubSubMemoryThreshold: 100 * 1024 * 1024, // 100MB
    };

    this.startCleanupInterval();
    this.logger.log('AnalysisCacheService initialized', {
      cacheEnabled: this.config.cacheEnabled,
      cacheTtl: this.config.cacheTtl,
      maxCacheSize: this.config.maxCacheSize,
    });
  }

  /**
   * Get analysis metadata from cache
   * Only for Neo4j database query results
   */
  getAnalysisMetadata(analysisId: string): AnalysisMetadata | null {
    if (!this.config.cacheEnabled) {
      return null;
    }

    const entry = this.cache.get(analysisId);
    
    if (!entry) {
      this.statistics.misses++;
      this.statistics.totalOperations++;
      return null;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(analysisId);
      this.statistics.misses++;
      this.statistics.totalOperations++;
      this.logger.debug('Cache entry expired', { analysisId });
      return null;
    }

    // Update hit count and return
    entry.hits++;
    this.statistics.hits++;
    this.statistics.totalOperations++;
    
    this.logger.debug('Cache hit for analysis metadata', { 
      analysisId, 
      hits: entry.hits,
      age: Date.now() - entry.timestamp 
    });
    
    return entry.metadata;
  }

  /**
   * Cache analysis metadata from Neo4j query results
   * NEVER cache module responses - they provide real-time data
   */
  setAnalysisMetadata(analysisId: string, metadata: AnalysisMetadata): void {
    if (!this.config.cacheEnabled) {
      return;
    }

    // Enforce cache size limit
    if (this.cache.size >= this.config.maxCacheSize) {
      this.evictOldestEntry();
    }

    const entry: AnalysisMetadataCacheEntry = {
      metadata,
      timestamp: Date.now(),
      ttl: this.config.cacheTtl,
      hits: 0,
    };

    this.cache.set(analysisId, entry);
    
    this.logger.debug('Cached analysis metadata', { 
      analysisId, 
      moduleName: metadata.moduleName,
      cacheSize: this.cache.size 
    });
  }

  /**
   * Invalidate cache entry for specific analysis
   */
  invalidateAnalysis(analysisId: string): void {
    const deleted = this.cache.delete(analysisId);
    if (deleted) {
      this.logger.debug('Invalidated analysis cache entry', { analysisId });
    }
  }

  /**
   * Invalidate all cache entries for a specific module
   */
  invalidateModule(moduleName: string): void {
    let invalidated = 0;
    
    for (const [analysisId, entry] of this.cache.entries()) {
      if (entry.metadata.moduleName === moduleName) {
        this.cache.delete(analysisId);
        invalidated++;
      }
    }

    if (invalidated > 0) {
      this.logger.log('Invalidated module cache entries', { 
        moduleName, 
        invalidated,
        remaining: this.cache.size 
      });
    }
  }

  /**
   * Clear all cache entries
   */
  clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.logger.log('Cache cleared', { entriesRemoved: size });
  }

  /**
   * Get cache statistics
   */
  getStatistics(): AnalysisCacheStatistics {
    const totalOperations = this.statistics.hits + this.statistics.misses;
    const hitRate = totalOperations > 0 ? this.statistics.hits / totalOperations : 0;
    const missRate = totalOperations > 0 ? this.statistics.misses / totalOperations : 0;

    // Calculate average age of cache entries
    const now = Date.now();
    let totalAge = 0;
    let entryCount = 0;

    for (const entry of this.cache.values()) {
      totalAge += now - entry.timestamp;
      entryCount++;
    }

    const averageAge = entryCount > 0 ? totalAge / entryCount : 0;

    // Estimate memory usage (rough calculation)
    const memoryUsage = this.cache.size * 200; // Approximate bytes per entry

    return {
      totalEntries: this.cache.size,
      hitRate,
      missRate,
      averageAge,
      memoryUsage,
    };
  }

  /**
   * Get health status of cache service
   */
  getHealthStatus(): {
    isHealthy: boolean;
    statistics: AnalysisCacheStatistics;
    issues: string[];
  } {
    const statistics = this.getStatistics();
    const issues: string[] = [];

    // Check for potential issues
    if (statistics.totalEntries >= this.config.maxCacheSize * 0.9) {
      issues.push('Cache approaching maximum size');
    }

    if (statistics.hitRate < 0.5 && statistics.totalEntries > 10) {
      issues.push('Low cache hit rate detected');
    }

    if (statistics.memoryUsage > 50 * 1024 * 1024) { // 50MB
      issues.push('High memory usage detected');
    }

    return {
      isHealthy: issues.length === 0,
      statistics,
      issues,
    };
  }

  /**
   * Get cache configuration
   */
  getConfig(): AnalysisResolverConfig {
    return { ...this.config };
  }

  /**
   * Update cache configuration
   */
  updateConfig(updates: Partial<AnalysisResolverConfig>): void {
    const { __proto__, constructor, prototype, ...safeUpdates } = updates as any;
    Object.assign(this.config, safeUpdates);
    this.logger.log('Cache configuration updated', safeUpdates);
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [analysisId, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(analysisId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger.debug('Cache cleanup completed', { 
        entriesRemoved: cleaned,
        remaining: this.cache.size 
      });
    }
  }

  /**
   * Evict oldest cache entry when at capacity
   */
  private evictOldestEntry(): void {
    let oldestKey: string | null = null;
    let oldestTimestamp = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.timestamp < oldestTimestamp) {
        oldestTimestamp = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.statistics.evictions++;
      this.logger.debug('Evicted oldest cache entry', { 
        analysisId: oldestKey,
        age: Date.now() - oldestTimestamp 
      });
    }
  }

  /**
   * Start automatic cleanup interval
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, this.config.cleanupInterval);

    this.logger.debug('Cache cleanup interval started', {
      interval: this.config.cleanupInterval,
    });
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  onModuleDestroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.logger.debug('Cache cleanup interval stopped');
    }
  }
}
