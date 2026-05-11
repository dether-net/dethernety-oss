import { Injectable, Logger } from '@nestjs/common';
import type { ClassKind } from '@dethernety/dt-module';

// Structured events emitted by the module-class reconciliation flow.
// Surfaced via the admin GraphQL surface (`classIdentityEvents` query).
// In-memory only — process restart wipes the buffer; persistent
// auditing relies on the Logger.warn mirror at the emit site.

export type ClassIdentityEvent =
  | {
      kind: 'rebind';
      moduleName: string;
      classKind: ClassKind;
      className: string;
      oldId: string;
      newId: string;
      policy: 'audit' | 'silent';
      timestamp: string;
    }
  | {
      kind: 'rebind-conflict';
      moduleName: string;
      classKind: ClassKind;
      className: string;
      moduleDeclaredId: string;
      dbId: string;
      policy: 'strict';
      timestamp: string;
    }
  | {
      kind: 'collision';
      firstModuleName: string;
      secondModuleName: string;
      classKind: ClassKind;
      className: string;
      collidingId: string;
      timestamp: string;
    }
  | {
      kind: 'orphan';
      moduleName: string;
      classKind: ClassKind;
      className: string;
      classId: string;
      reason: 'absent-from-metadata' | 'legacy-id-superseded';
      timestamp: string;
    }
  | {
      kind: 'revive';
      moduleName: string;
      classKind: ClassKind;
      className: string;
      classId: string;
      timestamp: string;
    };

export interface EventFilter {
  kind?: ClassIdentityEvent['kind'];
  moduleName?: string;
  /** ISO timestamp; only events at-or-after this point are returned. */
  since?: string;
}

const MAX_EVENTS = 1000;

@Injectable()
export class ClassIdentityEventLog {
  private readonly logger = new Logger(ClassIdentityEventLog.name);
  private events: ClassIdentityEvent[] = [];

  emit(event: ClassIdentityEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(this.events.length - MAX_EVENTS);
    }
    // Mirror every event to the journal for ops visibility — survives
    // process restart (the in-memory ring buffer does not). Silent-mode
    // policy events still log here; 'silent' suppresses structured event
    // emission, not journal mirroring.
    this.logger.warn(`class-identity event: ${event.kind}`, event);
  }

  list(filter?: EventFilter): ClassIdentityEvent[] {
    let out = this.events.slice();
    if (filter?.kind) out = out.filter((e) => e.kind === filter.kind);
    if (filter?.moduleName) {
      out = out.filter((e) => {
        if (e.kind === 'collision') {
          return e.firstModuleName === filter.moduleName || e.secondModuleName === filter.moduleName;
        }
        return (e as { moduleName?: string }).moduleName === filter.moduleName;
      });
    }
    if (filter?.since) {
      const since = filter.since;
      out = out.filter((e) => e.timestamp >= since);
    }
    return out;
  }

  /** Test-only helper. Avoid in production paths. */
  clear(): void {
    this.events = [];
  }

  size(): number {
    return this.events.length;
  }
}
