import * as Apollo from '@apollo/client'
import { DtUtils } from '../dt-utils/dt-utils.js'
import {
  Module,
  ClassIdentityEvent,
  IdentityMigrationReport
} from '../interfaces/core-types-interface.js'
import {
  GET_MODULES_WITH_IDENTITY,
  GET_CLASS_IDENTITY_EVENTS,
  MIGRATE_CLASS_ID,
  REVIVE_ORPHANED_CLASS,
  DELETE_ORPHANED_CLASS,
  RUN_IDENTITY_MIGRATION
} from './dt-class-identity-gql.js'

export interface ClassIdentityEventFilter {
  kind?: string
  moduleName?: string
  since?: string
}

export interface MigrateClassIdArgs {
  moduleName: string
  className: string
  classKind: string
  newId: string
}

export interface ReviveOrphanedClassArgs {
  classId: string
  classKind: string
}

export interface DeleteOrphanedClassArgs {
  classId: string
  classKind: string
  cascade: boolean
}

export interface RunIdentityMigrationArgs {
  dryRun: boolean
}

export class DtClassIdentity {
  private dtUtils: DtUtils

  constructor(apolloClient: Apollo.ApolloClient) {
    this.dtUtils = new DtUtils(apolloClient)
  }

  /**
   * Modules list augmented with the admin surface (install state, constraint
   * health, conflict details, and the seven orphaned-class lists with
   * incoming-instance breakdowns).
   */
  getModulesWithIdentity = async (): Promise<Module[]> => {
    const response = await this.dtUtils.performQuery<{ modules: Module[] }>({
      query: GET_MODULES_WITH_IDENTITY,
      action: 'getModulesWithIdentity',
      fetchPolicy: 'network-only'
    })
    return response.modules || []
  }

  /**
   * Class-identity events from the in-memory ring buffer (process-local,
   * drop-oldest at 1000). Optional filter mirrors the server-side query.
   */
  getClassIdentityEvents = async (
    filter: ClassIdentityEventFilter = {}
  ): Promise<ClassIdentityEvent[]> => {
    const response = await this.dtUtils.performQuery<{ classIdentityEvents: ClassIdentityEvent[] }>({
      query: GET_CLASS_IDENTITY_EVENTS,
      variables: {
        kind: filter.kind,
        moduleName: filter.moduleName,
        since: filter.since
      },
      action: 'getClassIdentityEvents',
      fetchPolicy: 'network-only'
    })
    return response.classIdentityEvents || []
  }

  /**
   * Admin: align the DB id of a (module, className) pair to a new id. Used
   * by the operator's ConflictResolutionDialog to resolve strict-mode rebind
   * conflicts. Server-side: requires admin role; emits an audit-log entry +
   * a `kind: 'rebind', policy: 'audit'` class-identity event.
   */
  migrateClassId = async (args: MigrateClassIdArgs): Promise<boolean> => {
    return this.dtUtils.performMutation<boolean>({
      mutation: MIGRATE_CLASS_ID,
      variables: args,
      dataPath: 'migrateClassId',
      action: 'migrateClassId'
    })
  }

  /**
   * Admin: revive an orphaned class (HAS_ORPHANED_CLASS → HAS_CLASS).
   * Idempotent. Server-side: requires admin role; emits an audit-log entry
   * + a `kind: 'revive'` class-identity event.
   */
  reviveOrphanedClass = async (args: ReviveOrphanedClassArgs): Promise<boolean> => {
    return this.dtUtils.performMutation<boolean>({
      mutation: REVIVE_ORPHANED_CLASS,
      variables: args,
      dataPath: 'reviveOrphanedClass',
      action: 'reviveOrphanedClass'
    })
  }

  /**
   * Admin: hard-delete an orphaned class. With `cascade=false` (operator
   * default), refuses if any :IS_INSTANCE_OF edges exist. With `cascade=true`,
   * DETACH DELETEs the class AND every incident instance node — capped at
   * 1000 server-side.
   */
  deleteOrphanedClass = async (args: DeleteOrphanedClassArgs): Promise<boolean> => {
    return this.dtUtils.performMutation<boolean>({
      mutation: DELETE_ORPHANED_CLASS,
      variables: args,
      dataPath: 'deleteOrphanedClass',
      action: 'deleteOrphanedClass'
    })
  }

  /**
   * Admin: re-run the idempotent class-identity cleanup migration.
   * `dryRun=true` reports planned actions without writing. Long-running
   * (~30s on typical databases). Returns counts + per-action details.
   */
  runIdentityMigration = async (
    args: RunIdentityMigrationArgs
  ): Promise<IdentityMigrationReport> => {
    return this.dtUtils.performMutation<IdentityMigrationReport>({
      mutation: RUN_IDENTITY_MIGRATION,
      variables: args,
      dataPath: 'runIdentityMigration',
      action: 'runIdentityMigration'
    })
  }
}
