import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnalysisCacheService } from '../analysis-cache.service';

const mockConfigService = {
  get: jest.fn().mockReturnValue({}),
};

describe('AnalysisCacheService', () => {
  let service: AnalysisCacheService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnalysisCacheService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<AnalysisCacheService>(AnalysisCacheService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  const sampleMetadata = {
    analysisClassId: 'class-1',
    moduleName: 'test-module',
    elementId: 'elem-1',
  };

  describe('get/set operations', () => {
    it('should return null for missing entries', () => {
      expect(service.getAnalysisMetadata('nonexistent')).toBeNull();
    });

    it('should store and retrieve metadata', () => {
      service.setAnalysisMetadata('analysis-1', sampleMetadata);
      expect(service.getAnalysisMetadata('analysis-1')).toEqual(sampleMetadata);
    });

    it('should track cache misses in statistics', () => {
      service.getAnalysisMetadata('miss-1');
      service.getAnalysisMetadata('miss-2');
      const stats = service.getStatistics();
      expect(stats.missRate).toBe(1);
      expect(stats.hitRate).toBe(0);
    });

    it('should track cache hits in statistics', () => {
      service.setAnalysisMetadata('hit-1', sampleMetadata);
      service.getAnalysisMetadata('hit-1');
      const stats = service.getStatistics();
      expect(stats.hitRate).toBeGreaterThan(0);
    });
  });

  describe('invalidation', () => {
    it('should invalidate a specific analysis', () => {
      service.setAnalysisMetadata('a1', sampleMetadata);
      service.invalidateAnalysis('a1');
      expect(service.getAnalysisMetadata('a1')).toBeNull();
    });

    it('should invalidate all entries for a module', () => {
      service.setAnalysisMetadata('a1', { ...sampleMetadata, moduleName: 'mod-a' });
      service.setAnalysisMetadata('a2', { ...sampleMetadata, moduleName: 'mod-a' });
      service.setAnalysisMetadata('a3', { ...sampleMetadata, moduleName: 'mod-b' });

      service.invalidateModule('mod-a');

      expect(service.getAnalysisMetadata('a1')).toBeNull();
      expect(service.getAnalysisMetadata('a2')).toBeNull();
      expect(service.getAnalysisMetadata('a3')).not.toBeNull();
    });

    it('should clear all cache entries', () => {
      service.setAnalysisMetadata('a1', sampleMetadata);
      service.setAnalysisMetadata('a2', sampleMetadata);
      service.clearCache();

      const stats = service.getStatistics();
      expect(stats.totalEntries).toBe(0);
    });
  });

  describe('health status', () => {
    it('should report healthy when cache is not full', () => {
      const health = service.getHealthStatus();
      expect(health.isHealthy).toBe(true);
      expect(health.issues).toHaveLength(0);
    });

    it('should include statistics in health response', () => {
      service.setAnalysisMetadata('a1', sampleMetadata);
      const health = service.getHealthStatus();
      expect(health.statistics.totalEntries).toBe(1);
    });
  });

  describe('configuration', () => {
    it('should return current config', () => {
      const config = service.getConfig();
      expect(config.cacheEnabled).toBe(true);
      expect(config.cacheTtl).toBeGreaterThan(0);
      expect(config.maxCacheSize).toBeGreaterThan(0);
    });

    it('should update config safely', () => {
      service.updateConfig({ maxCacheSize: 500 });
      expect(service.getConfig().maxCacheSize).toBe(500);
    });
  });
});
