import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GqlConfig } from '../gql.config';

interface CacheEntry {
  value: string;
  timestamp: Date;
  hits: number;
  lastAccessed: Date;
}

export interface CacheStatistics {
  totalEntries: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  totalSize: number; // Approximate size in characters
  oldestEntry?: Date;
  newestEntry?: Date;
}

/**
 * Template caching service for improved performance
 * Implements LRU cache with TTL for template and guide content
 */
@Injectable()
export class TemplateCacheService {
  private readonly logger = new Logger(TemplateCacheService.name);
  private readonly config: GqlConfig;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly defaultTTL = 15 * 60 * 1000; // 15 minutes
  private readonly maxCacheSize = 1000; // Maximum number of entries
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<GqlConfig>('gql')!;
    
    // Setup periodic cleanup
    setInterval(() => this.cleanup(), 5 * 60 * 1000); // Cleanup every 5 minutes
    
    this.logger.log('TemplateCacheService initialized', {
      defaultTTL: this.defaultTTL,
      maxCacheSize: this.maxCacheSize,
    });
  }

  /**
   * Generates cache key for template/guide
   */
  private generateKey(type: 'template' | 'guide', moduleName: string, id?: string): string {
    return id ? `${type}:${moduleName}:${id}` : `${type}:${moduleName}`;
  }

  /**
   * Gets cached template/guide if available and not expired
   */
  get(type: 'template' | 'guide', moduleName: string, id?: string): string | null {
    const key = this.generateKey(type, moduleName, id);
    const entry = this.cache.get(key);

    if (!entry) {
      this.missCount++;
      this.logger.debug('Cache miss', { key, type, moduleName, id });
      return null;
    }

    // Check if expired
    const now = new Date();
    const age = now.getTime() - entry.timestamp.getTime();
    
    if (age > this.defaultTTL) {
      this.cache.delete(key);
      this.missCount++;
      this.logger.debug('Cache expired', { key, age, ttl: this.defaultTTL });
      return null;
    }

    // Update access statistics
    entry.hits++;
    entry.lastAccessed = now;
    this.hitCount++;

    this.logger.debug('Cache hit', { 
      key, 
      hits: entry.hits, 
      age,
      type, 
      moduleName, 
      id 
    });

    return entry.value;
  }

  /**
   * Stores template/guide in cache
   */
  set(type: 'template' | 'guide', moduleName: string, value: string, id?: string): void {
    const key = this.generateKey(type, moduleName, id);
    const now = new Date();

    // Check cache size limit
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLRU();
    }

    const entry: CacheEntry = {
      value,
      timestamp: now,
      hits: 0,
      lastAccessed: now,
    };

    this.cache.set(key, entry);

    this.logger.debug('Cache set', { 
      key, 
      valueLength: value.length, 
      cacheSize: this.cache.size,
      type,
      moduleName,
      id 
    });
  }

  /**
   * Invalidates cache entries for a specific module
   */
  invalidateModule(moduleName: string): void {
    const keysToDelete = Array.from(this.cache.keys())
      .filter(key => key.includes(`:${moduleName}:`));

    keysToDelete.forEach(key => this.cache.delete(key));

    this.logger.log('Module cache invalidated', { 
      moduleName, 
      entriesRemoved: keysToDelete.length 
    });
  }

  /**
   * Invalidates specific template/guide
   */
  invalidate(type: 'template' | 'guide', moduleName: string, id?: string): void {
    const key = this.generateKey(type, moduleName, id);
    const deleted = this.cache.delete(key);

    this.logger.debug('Cache invalidated', { 
      key, 
      deleted, 
      type, 
      moduleName, 
      id 
    });
  }

  /**
   * Clears all cache entries
   */
  clear(): void {
    const size = this.cache.size;
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;

    this.logger.log('Cache cleared', { entriesRemoved: size });
  }

  /**
   * Evicts least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = new Date();

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < oldestTime) {
        oldestTime = entry.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.logger.debug('LRU eviction', { 
        evictedKey: oldestKey, 
        lastAccessed: oldestTime 
      });
    }
  }

  /**
   * Removes expired entries
   */
  private cleanup(): void {
    const now = new Date();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.cache.entries()) {
      const age = now.getTime() - entry.timestamp.getTime();
      if (age > this.defaultTTL) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.cache.delete(key));

    if (keysToDelete.length > 0) {
      this.logger.debug('Cache cleanup completed', { 
        expiredEntries: keysToDelete.length,
        remainingEntries: this.cache.size 
      });
    }
  }

  /**
   * Gets cache statistics
   */
  getStatistics(): CacheStatistics {
    let totalSize = 0;
    let oldestEntry: Date | undefined;
    let newestEntry: Date | undefined;

    for (const entry of this.cache.values()) {
      totalSize += entry.value.length;
      
      if (!oldestEntry || entry.timestamp < oldestEntry) {
        oldestEntry = entry.timestamp;
      }
      
      if (!newestEntry || entry.timestamp > newestEntry) {
        newestEntry = entry.timestamp;
      }
    }

    const totalRequests = this.hitCount + this.missCount;
    const hitRate = totalRequests > 0 ? (this.hitCount / totalRequests) * 100 : 0;

    return {
      totalEntries: this.cache.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: Math.round(hitRate * 100) / 100,
      totalSize,
      oldestEntry,
      newestEntry,
    };
  }

  /**
   * Gets cache health status
   */
  getHealthStatus() {
    const stats = this.getStatistics();
    
    return {
      healthy: stats.hitRate >= 70, // Consider healthy if 70%+ hit rate
      hitRate: stats.hitRate,
      totalEntries: stats.totalEntries,
      cacheUtilization: (stats.totalEntries / this.maxCacheSize) * 100,
      approximateMemoryUsage: `${Math.round(stats.totalSize / 1024)} KB`,
    };
  }
}
