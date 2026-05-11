import { gql } from 'graphql-tag'

const ORPHAN_FIELDS = `
  id
  name
  orphanedAt
  incomingInstanceCount
  incomingInstancesByType { type count }
`

export const GET_MODULES_WITH_IDENTITY = gql`
  query GetModulesWithIdentity {
    modules {
      id
      name
      description
      version
      attributes
      template
      idRebindPolicy
      lastInstallStatus
      lastAttemptedInstall
      lastAuthoritativeInstall
      rebindConflicts { className classKind dbId moduleDeclaredId }
      constraintsHealthy
      orphanedComponentClasses { ${ORPHAN_FIELDS} }
      orphanedDataFlowClasses { ${ORPHAN_FIELDS} }
      orphanedSecurityBoundaryClasses { ${ORPHAN_FIELDS} }
      orphanedControlClasses { ${ORPHAN_FIELDS} }
      orphanedDataClasses { ${ORPHAN_FIELDS} }
      orphanedAnalysisClasses { ${ORPHAN_FIELDS} }
      orphanedIssueClasses { ${ORPHAN_FIELDS} }
    }
  }
`

export const GET_CLASS_IDENTITY_EVENTS = gql`
  query GetClassIdentityEvents($kind: String, $moduleName: String, $since: String) {
    classIdentityEvents(kind: $kind, moduleName: $moduleName, since: $since) {
      kind
      timestamp
      moduleName
      classKind
      className
      oldId
      newId
      moduleDeclaredId
      dbId
      policy
      classId
      reason
      firstModuleName
      secondModuleName
      collidingId
    }
  }
`

export const MIGRATE_CLASS_ID = gql`
  mutation MigrateClassId(
    $moduleName: String!
    $className: String!
    $classKind: String!
    $newId: ID!
  ) {
    migrateClassId(
      moduleName: $moduleName
      className: $className
      classKind: $classKind
      newId: $newId
    )
  }
`

export const REVIVE_ORPHANED_CLASS = gql`
  mutation ReviveOrphanedClass($classId: ID!, $classKind: String!) {
    reviveOrphanedClass(classId: $classId, classKind: $classKind)
  }
`

export const DELETE_ORPHANED_CLASS = gql`
  mutation DeleteOrphanedClass(
    $classId: ID!
    $classKind: String!
    $cascade: Boolean!
  ) {
    deleteOrphanedClass(classId: $classId, classKind: $classKind, cascade: $cascade)
  }
`

export const RUN_IDENTITY_MIGRATION = gql`
  mutation RunIdentityMigration($dryRun: Boolean!) {
    runIdentityMigration(dryRun: $dryRun) {
      dryRun
      totalActions
      details
    }
  }
`
