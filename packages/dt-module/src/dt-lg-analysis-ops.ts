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
 * pattern of DbOps - it can be used independently or as part of
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
  /**
   * One AbortController per in-flight run, keyed by sessionId. The single owner of run
   * cancellation: `startStream` registers on start and clears in `finally`; `stopRun`,
   * `deleteSession` and `abortAll` cancel through it. Its `has(sessionId)` also lets a new
   * run supersede an active one on the same session (no interleave on the shared channel).
   */
  private readonly runs = new Map<string, AbortController>();

  constructor(
    private readonly client: Client,
    private readonly config: LgAnalysisConfig,
    private readonly logger: Logger
  ) {
    this.logger.log('DtLgAnalysisOps initialized');
  }

  /**
   * Abort the in-flight run for a session, if any, and drop its registry entry.
   * @returns true if a live run was found and aborted.
   */
  private abortRun(id: string): boolean {
    const controller = this.runs.get(id);
    if (!controller) return false;
    controller.abort();
    this.runs.delete(id);
    return true;
  }

  /**
   * Explicitly cancel an in-flight run (backs DtLgModule.stopAnalysis). The run's server-side
   * lifecycle is decoupled; this stops the observation stream and its publishing.
   */
  stopRun(id: string): boolean {
    return this.abortRun(id);
  }

  /** Abort every in-flight run and clear the registry (backs DtLgModule.dispose). */
  abortAll(): void {
    for (const controller of this.runs.values()) controller.abort();
    this.runs.clear();
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
    // Abort any in-flight run for this session BEFORE tearing down the thread, so the
    // stream loop breaks and stops publishing to a session that is about to be deleted.
    this.abortRun(id);
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

      const rawInput = await graphConfig.input(scope, sessionId, driver, additionalParams);

      // Extract _configurable from input if present (e.g., model_name selection).
      // This allows graph configs to pass RunnableConfig.configurable without
      // changing the LgGraphConfig interface.
      const { _configurable, ...input } = rawInput;
      const payload: Record<string, unknown> = {
        input,
        streamMode: 'updates',
        streamSubgraphs: true,
      };
      if (_configurable && typeof _configurable === 'object') {
        payload.config = { configurable: _configurable };
      }

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
    // Read-only existence probe. A status poll must NEVER create the thread — the old
    // create-on-read re-materialised a just-deleted session as an empty-scope zombie. A
    // missing/unreachable thread is reported as a benign not-started status (maps to the
    // UI's "ready" phase), not 'failed', which would render a spurious error/retry state.
    let thread: unknown;
    try {
      thread = await this.client.threads.get(sessionId);
    } catch (error) {
      this.logger.debug('Analysis session not found on status probe', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return this.notFoundStatus();
    }
    if (!thread) {
      return this.notFoundStatus();
    }

    try {
      const state = await this.client.threads.getState(sessionId);

      let messages: any[] = [];
      if (state?.values && typeof state.values === 'object' && 'messages' in state.values) {
        messages = state.values.messages as any[];
      }

      let status = (thread as any).status;
      // hasDocument is only consulted by the UI when status is idle (Ready vs
      // Done); on running/interrupted/error it is irrelevant, so false is fine.
      let hasDocument = false;
      if (status === 'idle') {
        const runs = await this.client.runs.list(sessionId);
        if (runs && runs.length > 0 && runs[0].status === 'running') {
          status = 'running';
        }
        // A completed run means a viewable result exists. Reuses the runs list
        // already fetched above — no extra round-trip. The list is newest-first;
        // at idle the terminal success run is the most recent, so it is within
        // the default page even after many interrupt/resume rounds. A re-run
        // deletes the thread first (clearing prior run rows), so a stale success
        // can't linger across runs.
        hasDocument = !!runs && runs.some(r => r.status === 'success');
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
        hasDocument,
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
        hasDocument: false,
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
    // Register a cancellable handle for this run. A new run on the same session SUPERSEDES
    // any active one (abort it first) so two runs never interleave on the one streamResponse
    // channel. stopRun/deleteSession/abortAll cancel through this controller.
    const controller = new AbortController();
    this.runs.get(sessionId)?.abort();
    this.runs.set(sessionId, controller);
    try {
      // Durable runs: keep the run executing if the observing stream
      // disconnects. The create-and-stream endpoint defaults on_disconnect
      // to "cancel", so a dropped SSE stream (browser refresh, navigation,
      // a transient network blip on this consumer) would otherwise CANCEL
      // the underlying run — a long analysis would die the moment the user
      // refreshed. "continue" decouples the run lifecycle from this
      // observation stream; progress is still recoverable via thread-state
      // polling and a re-attached /stream join. Callers may override.
      // `signal` is last so payload can never clobber it — aborting it cancels this stream.
      const streamResponse = await this.client.runs.stream(
        sessionId,
        assistantId,
        { onDisconnect: 'continue', ...payload, signal: controller.signal }
      );

      // A run that fails INSIDE the graph is delivered as a yielded `error`
      // event, not a thrown exception (the SDK throws only on transport
      // failures). The content filters below skip it, so capture it here and
      // report a terminal 'error' — otherwise a failed run ends the loop
      // normally and would be published as a false 'complete'.
      let streamError: string | null = null;

      for await (const chunk of streamResponse) {
        // A chunk can arrive buffered just as an abort (stop/delete/supersede) fires — the SDK
        // may resolve a read() with a value before the abort propagates. Stop before publishing
        // it, so no content chunk leaks to a torn-down session or interleaves onto a superseding
        // run's channel (both share this sessionId).
        if (controller.signal.aborted) break;

        const typedChunk = chunk as AnalysisChunk;

        if (typedChunk.event === 'error') {
          streamError = this.extractStreamError(typedChunk.data);
          continue;
        }

        if (streamMode === 'messages-tuple' &&
            typedChunk.event.startsWith('messages') &&
            Array.isArray(typedChunk.data)) {
          for (const message of typedChunk.data) {
            if (message?.content !== undefined && message.type === 'AIMessageChunk') {
              pubSub.publish('streamResponse', {
                streamResponse: this.projectMessage(message),
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
                streamResponse: this.projectMessage(message),
                sessionId,
              });
            }
          }
        }
      }

      // Terminal event: the stream ended. Report 'error' if the run failed
      // in-graph, else 'complete'. Subscribers otherwise receive only content
      // chunks and never learn the run finished.
      // Skip when this run was aborted (stop/delete/supersede): the session may be gone or
      // owned by a newer run, so a terminal frame here would be a publish-after-delete.
      if (streamError) {
        this.logger.error('Analysis run errored in-graph', { sessionId, error: streamError });
      }
      if (!controller.signal.aborted) {
        pubSub.publish('streamResponse', {
          streamResponse: streamError
            ? this.makeTerminalChunk('error', streamError)
            : this.makeTerminalChunk('complete'),
          sessionId,
        });
      }
      return !streamError;
    } catch (error) {
      // An intentional abort surfaces here as an AbortError when it interrupts an in-flight
      // read. It is a cancellation, not a failure — do not log-as-error or publish to a
      // session that is being torn down or superseded.
      if (controller.signal.aborted) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('Stream failed', { sessionId, error: message });
      // Terminal event: surface the failure so subscribers stop waiting.
      pubSub.publish('streamResponse', {
        streamResponse: this.makeTerminalChunk('error', message),
        sessionId,
      });
      return false;
    } finally {
      // Only clear our own entry — a superseding run may already own this session's slot.
      if (this.runs.get(sessionId) === controller) {
        this.runs.delete(sessionId);
      }
    }
  }

  /**
   * Best-effort human message out of a LangGraph `error` stream event's data,
   * which has no fixed shape (often { error, message } or a bare string).
   */
  private extractStreamError(data: unknown): string {
    if (typeof data === 'string') return data;
    if (data && typeof data === 'object') {
      const d = data as Record<string, unknown>;
      const msg = d.message ?? d.error;
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    return 'Analysis run failed';
  }

  /**
   * Build a terminal stream chunk (AIResponse-shaped) marking a stream's end.
   * The `type` ('complete' | 'error') lets subscribers close out.
   *
   * `content` is intentionally EMPTY on both terminals so a content-only
   * subscriber (today's dt-ui renders any chunk with truthy `content` as a chat
   * message) ignores them entirely — a terminal must not render as a message.
   * An error's human detail rides on `additional_kwargs.error` instead, where a
   * type-aware consumer reads it after branching on `type === 'error'`.
   */
  /**
   * A benign "no such run" status for a missing/unreachable thread. An empty `status` maps to
   * the UI's "ready" phase (the analysis can be run) and triggers neither the flow dialog's
   * `'idle'`→navigate-to-results branch nor its error icon — unlike `'failed'`, which would
   * render a spurious error/retry state for a session that simply does not exist.
   */
  private notFoundStatus(): AnalysisStatus {
    return {
      createdAt: '',
      updatedAt: '',
      status: '',
      hasDocument: false,
      interrupts: {},
      messages: [],
      metadata: {},
    };
  }

  /**
   * Project a streamed LangGraph message to the canonical AIResponse field set before it
   * crosses the pubSub trust boundary. Drops `response_metadata` and any other backend/LLM
   * internals (model name, token usage, system fingerprint, logprobs) that the raw message
   * carries verbatim. This is exactly the field set makeTerminalChunk and the dt-ws
   * null-fallback already use, so content chunks and terminals stay shape-consistent.
   */
  private projectMessage(msg: any): Record<string, unknown> {
    return {
      content: msg?.content ?? '',
      id: msg?.id ?? '',
      type: msg?.type,
      name: msg?.name ?? null,
      example: msg?.example ?? false,
      additional_kwargs: msg?.additional_kwargs ?? {},
      tool_calls: msg?.tool_calls ?? [],
      invalid_tool_calls: msg?.invalid_tool_calls ?? [],
      usage_metadata: msg?.usage_metadata ?? {},
      tool_call_chunks: msg?.tool_call_chunks ?? [],
    };
  }

  private makeTerminalChunk(type: 'complete' | 'error', errorMessage = ''): Record<string, unknown> {
    return {
      content: '',
      id: '',
      type,
      name: type === 'error' ? 'Error' : 'Complete',
      example: false,
      additional_kwargs: type === 'error' && errorMessage ? { error: errorMessage } : {},
      tool_calls: [],
      invalid_tool_calls: [],
      usage_metadata: {},
      tool_call_chunks: [],
    };
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
