import { DTMetadata } from './module-metadata-interface';
import { Exposure } from './exposure-interface';
import { Countermeasure } from './countermeasure-interface';
import { AnalysisSession, AnalysisStatus } from '@dethernety/dt-core';
import { PubSubEngine } from 'graphql-subscriptions';

export interface ExtendedPubSubEngine extends PubSubEngine {
  asyncIterator<T>(triggers: string | string[]): AsyncIterator<T>;
}

export interface DTModule {
  getMetadata(): DTMetadata | Promise<DTMetadata>;
  getModuleTemplate?(): Promise<string>;
  getClassTemplate?(id: string): Promise<string>;
  getClassGuide?(id: string): Promise<string>;
  getExposures?(id: string, classId: string): Promise<Exposure[]>;
  getCountermeasures?(id: string, classId: string): Promise<Countermeasure[]>;

  runAnalysis?(id: string, analysisClassId: string, scope: string, pubSub: ExtendedPubSubEngine, additionalParams?: object): Promise<AnalysisSession>;
  startChat?(id: string, analysisClassId: string, scope: string, userQuestion: string, pubSub: ExtendedPubSubEngine, additionalParams?: object): Promise<AnalysisSession>;
  resumeAnalysis?(id: string, analysisClassId: string, input: any, pubSub: ExtendedPubSubEngine): Promise<AnalysisSession>;
  getAnalysisStatus?(id: string): Promise<AnalysisStatus>;
  getAnalysisValueKeys?(id: string): Promise<string[]>;
  getAnalysisValues?(id: string, valueKey: string): Promise<object>;
  getDocument?(id: string, analysisClassId: string, scope: string, filter: object): Promise<object>;
  deleteAnalysis?(id: string): Promise<boolean>;
  stopAnalysis?(id: string): Promise<boolean>;

  getSyncedIssueAttributes?(issueId: string, attributes: string, lastSyncAt: string): Promise<string>;

  /** Return a GraphQL SDL fragment to extend the platform schema. Optional. */
  getSchemaExtension?(): string | Promise<string | undefined> | undefined;
}