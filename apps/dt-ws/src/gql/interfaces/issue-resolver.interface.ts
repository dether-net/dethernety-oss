export interface IssueAttributes {
  [key: string]: any;
}

export interface SyncMetadata {
  lastSyncAt: string;
  syncedAt: string;
  synced: boolean;
  message: string | null;
}

export interface SyncedAttributesResponse {
  attributes: IssueAttributes;
  _metadata: SyncMetadata;
}

export interface IssueResolverInput {
  id: string;
  attributes: string | null;
  issueClass: Array<{
    module: Array<{
      name: string;
    }>;
  }>;
  lastSyncAt: string | null;
}

export interface SyncRequest {
  issueId: string;
  attributes: string | null;
  moduleName: string;
  lastSyncAt: string | null;
}

export interface SyncResult {
  success: boolean;
  attributes: IssueAttributes;
  metadata: SyncMetadata;
  duration: number;
  error?: string;
}

export interface SyncValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface IssueOperationStatistics {
  totalSyncRequests: number;
  successfulSyncs: number;
  failedSyncs: number;
  averageSyncTime: number;
  syncsByModule: Map<string, {
    requests: number;
    successes: number;
    failures: number;
    averageTime: number;
  }>;
}

export interface DatabaseOperationResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  duration: number;
}
