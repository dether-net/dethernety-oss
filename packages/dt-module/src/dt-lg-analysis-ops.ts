import { Client } from '@langchain/langgraph-sdk';
import { Logger } from '@nestjs/common';
import { AnalysisSession, AnalysisStatus } from '@dethernety/dt-core';
import { ExtendedPubSubEngine } from './interfaces/module-interface';
import { LgAnalysisConfig } from './interfaces/lg-analysis-config-interface';

/**
 * Internal interface for analysis messages from LangGraph.
 */
interface AnalysisMessage {
  content: string;
  additional_kwargs: Record<string, any>;
  response_metadata: Record<string, any>;
  type: string;
  name: string | null;
  id: string;
}

/**
 * Internal interface for analysis chunk data.
 */
interface AnalysisChunkData {
  messages?: AnalysisMessage[];
  [key: string]: any;
}

/**
 * Internal interface for analysis chunks from LangGraph streaming.
 */
interface AnalysisChunk {
  event: string;
  data: AnalysisChunkData;
}

/**
 * Internal interface for extracted messages.
 */
interface Message {
  role: string;
  content: string;
}

/**
 * Helper class for LangGraph analysis operations.
 *
 * Provides methods for managing analysis sessions (threads), running analyses,
 * streaming results, and retrieving analysis state. This class follows the
 * pattern of DbOps and OpaOps - it can be used independently or as part of
 * a DtLgModule.
 *
 * @example
 * ```typescript
 * const client = new Client({ apiUrl: 'http://localhost:8123' });
 * const analysisOps = new DtLgAnalysisOps(client, analysisConfig, logger);
 *
 * // Create and run an analysis
 * const session = await analysisOps.createSession('session-1', 'model-123');
 * await analysisOps.runAnalysis('session-1', 'assistant-id', 'Graph Name', 'model-123', pubSub);
 *
 * // Check status
 * const status = await analysisOps.getStatus('session-1');
 * ```
 */
export class DtLgAnalysisOps {
  constructor(
    private readonly client: Client,
    private readonly config: LgAnalysisConfig,
    private readonly logger: Logger
  ) {
    this.logger.log('DtLgAnalysisOps initialized');
  }

  // ==========================================================================
  // Session Management
  // ==========================================================================

  /**
   * Creates or retrieves an analysis session (thread).
   *
   * @param id - Unique session identifier
   * @param scope - Scope identifier (typically model ID)
   * @returns Promise resolving to analysis session
   */
  async createSession(id: string, scope: string): Promise<AnalysisSession> {
    try {
      const thread = await this.client.threads.create({
        metadata: { scope },
        threadId: id,
        ifExists: 'do_nothing',
      });
      return { sessionId: thread.thread_id };
    } catch (error) {
      this.logger.error('Failed to create analysis session', {
        sessionId: id,
        scope,
        error: error instanceof Error ? error.message : String(error)
      });
      return { sessionId: '' };
    }
  }

  /**
   * Deletes an analysis session.
   *
   * @param id - Session identifier to delete
   * @returns Promise resolving to true if deleted, false otherwise
   */
  async deleteSession(id: string): Promise<boolean> {
    try {
      await this.client.threads.delete(id);
      this.logger.debug('Analysis session deleted', { sessionId: id });
      return true;
    } catch (error) {
      this.logger.warn('Failed to delete analysis session', {
        sessionId: id,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  // ==========================================================================
  // Analysis Execution
  // ==========================================================================

  /**
   * Runs an analysis using the specified graph configuration.
   *
   * Creates a new session, builds the input payload using the graph config,
   * and starts streaming the analysis results.
   *
   * @param sessionId - Unique session identifier
   * @param assistantId - LangGraph assistant ID
   * @param graphName - Name of the graph (key in config.graphs)
   * @param scope - Scope identifier (typically model ID)
   * @param pubSub - PubSub engine for streaming results
   * @param driver - Optional Neo4j driver for database queries
   * @param additionalParams - Optional additional parameters for the analysis
   * @returns Promise resolving to analysis session
   */
  async runAnalysis(
    sessionId: string,
    assistantId: string,
    graphName: string,
    scope: string,
    pubSub: ExtendedPubSubEngine,
    driver?: any,
    additionalParams?: object
  ): Promise<AnalysisSession> {
    const startTime = Date.now();
    this.logger.log('Starting analysis run', {
      sessionId,
      assistantId,
      graphName,
      scope
    });

    try {
      const graphConfig = this.config.graphs[graphName];
      if (!graphConfig) {
        throw new Error(`No config found for graph ${graphName}`);
      }

      const input = await graphConfig.input(scope, sessionId, driver, additionalParams);
      const payload = {
        input,
        streamMode: 'updates',
        streamSubgraphs: true,
      };

      // Start streaming in background
      this.startStream(sessionId, assistantId, payload, pubSub, 'updates').catch(error => {
        this.logger.error('Background streaming failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      });

      const duration = Date.now() - startTime;
      this.logger.log('Analysis run started successfully', {
        sessionId,
        duration: `${duration}ms`
      });

      return { sessionId };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to run analysis', {
        sessionId,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error)
      });
      return { sessionId: '' };
    }
  }

  /**
   * Starts a chat session with the specified assistant.
   *
   * @param sessionId - Unique session identifier
   * @param assistantId - LangGraph assistant ID
   * @param userQuestion - Initial user question/prompt
   * @param scope - Scope identifier (typically model ID)
   * @param pubSub - PubSub engine for streaming results
   * @returns Promise resolving to analysis session
   */
  async startChat(
    sessionId: string,
    assistantId: string,
    userQuestion: string,
    scope: string,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession> {
    const startTime = Date.now();
    this.logger.log('Starting chat session', {
      sessionId,
      assistantId,
      scope
    });

    try {
      const payload = {
        input: {
          user_query: userQuestion,
          analysis_id: sessionId,
          model_id: scope,
        },
        streamMode: 'messages-tuple',
        streamSubgraphs: true,
      };

      this.startStream(sessionId, assistantId, payload, pubSub, 'messages-tuple').catch(error => {
        this.logger.error('Background chat streaming failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      });

      const duration = Date.now() - startTime;
      this.logger.log('Chat session started successfully', {
        sessionId,
        duration: `${duration}ms`
      });

      return { sessionId };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error('Failed to start chat', {
        sessionId,
        duration: `${duration}ms`,
        error: error instanceof Error ? error.message : String(error)
      });
      return { sessionId: '' };
    }
  }

  /**
   * Resumes a paused/interrupted analysis session.
   *
   * @param sessionId - Session identifier to resume
   * @param assistantId - LangGraph assistant ID
   * @param input - Resume input (typically interrupt response)
   * @param pubSub - PubSub engine for streaming results
   * @returns Promise resolving to analysis session
   */
  async resumeAnalysis(
    sessionId: string,
    assistantId: string,
    input: any,
    pubSub: ExtendedPubSubEngine
  ): Promise<AnalysisSession> {
    this.logger.log('Resuming analysis session', {
      sessionId,
      assistantId
    });

    try {
      const payload = {
        command: { resume: input },
        streamMode: 'updates',
        streamSubgraphs: true,
      };

      this.startStream(sessionId, assistantId, payload, pubSub, 'updates').catch(error => {
        this.logger.error('Background resume streaming failed', {
          sessionId,
          error: error instanceof Error ? error.message : String(error)
        });
      });

      return { sessionId };
    } catch (error) {
      this.logger.error('Failed to resume analysis', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { sessionId: '' };
    }
  }

  // ==========================================================================
  // Status and Values
  // ==========================================================================

  /**
   * Gets the current status of an analysis session.
   *
   * @param sessionId - Session identifier
   * @returns Promise resolving to analysis status
   */
  async getStatus(sessionId: string): Promise<AnalysisStatus> {
    try {
      // Ensure session exists
      await this.createSession(sessionId, '');

      const thread = await this.client.threads.get(sessionId);
      if (!thread) {
        throw new Error(`Analysis session ${sessionId} not found`);
      }

      const state = await this.client.threads.getState(sessionId);

      let messages: any[] = [];
      if (state?.values && typeof state.values === 'object' && 'messages' in state.values) {
        messages = state.values.messages as any[];
      }

      let status = (thread as any).status;
      if (status === 'idle') {
        const runs = await this.client.runs.list(sessionId);
        if (runs && runs.length > 0 && runs[0].status === 'running') {
          status = 'running';
        }
      }

      // Extract interrupts from state
      let interrupts: Record<string, any[]> = {};
      const stateInterrupts = (state as any)?.interrupts;
      if (stateInterrupts && Array.isArray(stateInterrupts) && stateInterrupts.length > 0) {
        interrupts = { default: stateInterrupts };
      }

      return {
        createdAt: (thread as any).created_at,
        updatedAt: (thread as any).updated_at,
        status,
        interrupts,
        messages,
        metadata: (thread as any).metadata || {},
      };
    } catch (error) {
      this.logger.error('Failed to get analysis status', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return {
        createdAt: '',
        updatedAt: '',
        status: 'failed',
        interrupts: {},
        messages: [],
        metadata: {},
      };
    }
  }

  /**
   * Gets the available value keys from an analysis session state.
   *
   * @param sessionId - Session identifier
   * @returns Promise resolving to array of value key names
   */
  async getValueKeys(sessionId: string): Promise<string[]> {
    try {
      const thread = await this.client.threads.getState(sessionId);
      if (thread.values && typeof thread.values === 'object') {
        return Object.keys(thread.values);
      }
      return [];
    } catch (error) {
      this.logger.error('Failed to get analysis value keys', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * Gets a specific value from an analysis session state.
   *
   * @param sessionId - Session identifier
   * @param key - Key of the value to retrieve
   * @returns Promise resolving to the value object
   */
  async getValue(sessionId: string, key: string): Promise<object> {
    try {
      const thread = await this.client.threads.getState(sessionId);
      if (thread.values && typeof thread.values === 'object' && key in thread.values) {
        return (thread.values as any)[key];
      }
      return {};
    } catch (error) {
      this.logger.error('Failed to get analysis value', {
        sessionId,
        key,
        error: error instanceof Error ? error.message : String(error)
      });
      return {};
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Starts streaming from LangGraph and publishes events to PubSub.
   */
  private async startStream(
    sessionId: string,
    assistantId: string,
    payload: any,
    pubSub: ExtendedPubSubEngine,
    streamMode: string
  ): Promise<boolean> {
    try {
      const streamResponse = await this.client.runs.stream(
        sessionId,
        assistantId,
        payload
      );

      for await (const chunk of streamResponse) {
        const typedChunk = chunk as AnalysisChunk;

        if (streamMode === 'messages-tuple' &&
            typedChunk.event.startsWith('messages') &&
            Array.isArray(typedChunk.data)) {
          for (const message of typedChunk.data) {
            if (message?.content !== undefined && message.type === 'AIMessageChunk') {
              pubSub.publish('streamResponse', {
                streamResponse: message,
                sessionId,
              });
            }
          }
        } else if (streamMode === 'updates' &&
                   typedChunk.event.includes(streamMode) &&
                   typedChunk.data) {
          const messages = this.extractMessages(typedChunk.data);
          for (const message of messages) {
            if (message?.content !== undefined) {
              pubSub.publish('streamResponse', {
                streamResponse: message,
                sessionId,
              });
            }
          }
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Stream failed', {
        sessionId,
        error: error instanceof Error ? error.message : String(error)
      });
      return false;
    }
  }

  /**
   * Extracts messages from nested object structure.
   */
  private extractMessages(obj: any, depth: number = 0): Message[] {
    if (depth > 20 || !obj || typeof obj !== 'object') {
      return [];
    }
    let messages: Message[] = [];
    for (const key in obj) {
      if (key === 'messages' && Array.isArray(obj[key])) {
        messages = messages.concat(obj[key]);
      } else {
        messages = messages.concat(this.extractMessages(obj[key], depth + 1));
      }
    }
    return messages;
  }
}
