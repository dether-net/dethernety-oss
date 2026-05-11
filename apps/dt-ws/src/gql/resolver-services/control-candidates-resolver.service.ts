import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthorizationService } from '../services/authorization.service';
import { MonitoringService } from '../services/monitoring.service';
import { safeErrorMessage } from '../../common/utils/safe-error-message';

// --- Constants ---

const MAX_ELEMENT_TYPES = 20;

// --- Interfaces ---

interface ControlClassFitRow {
  classId: string;
  className: string;
  moduleId: string;
  moduleName: string;
  compatible: boolean;
  countermeasureCount: number;
}

interface ControlCandidateRow {
  controlId: string;
  controlName: string;
  classes: ControlClassFitRow[];
  totalCountermeasures: number;
  assignedElementIds: string[];
}

// --- Service ---

@Injectable()
export class ControlCandidatesResolverService {
  private readonly logger = new Logger(ControlCandidatesResolverService.name);

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly configService: ConfigService,
    private readonly authorizationService: AuthorizationService,
    private readonly monitoringService: MonitoringService,
  ) {
    this.logger.log('ControlCandidatesResolverService initialized');
  }

  // --- Input validation ---

  private validateInput(elementTypes: string[], moduleIds: string[]): void {
    if (!elementTypes || elementTypes.length === 0) {
      throw new Error('At least one elementType is required');
    }
    if (elementTypes.length > MAX_ELEMENT_TYPES) {
      throw new Error(
        `Maximum ${MAX_ELEMENT_TYPES} elementTypes allowed, received ${elementTypes.length}`,
      );
    }
  }

  // --- Database helpers ---

  private getSession() {
    return this.neo4jDriver.session({
      database: this.configService.get('database.name') || 'neo4j',
    });
  }

  // --- controlCandidatesForType ---

  private async executeControlCandidatesForType(
    elementTypes: string[],
    moduleIds: string[],
  ): Promise<ControlCandidateRow[]> {
    this.validateInput(elementTypes, moduleIds);

    const session = this.getSession();
    try {
      // Orphan-aware: :HAS_CLASS implicitly excludes orphans
      // (HAS_ORPHANED_CLASS) — control candidate discovery should not
      // suggest controls bound to retired classes.
      const query = `
        MATCH (ctrl:Control)-[:IS_INSTANCE_OF]->(cc:ControlClass)<-[:HAS_CLASS]-(m:Module)
        WHERE ANY(et IN $elementTypes WHERE et IN cc.supportedTypes)
          AND (size($moduleIds) = 0 OR m.id IN $moduleIds)
        OPTIONAL MATCH (ctrl)-[:HAS_COUNTERMEASURE]->(cm:Countermeasure)
                       -[:IS_COUNTERMEASURE_OF]->(cmClass:ControlClass)
        WHERE cmClass.id = cc.id
        WITH ctrl, cc, m, count(DISTINCT cm) AS cmCount
        WITH ctrl,
             collect({
               classId: cc.id, className: cc.name,
               moduleId: m.id, moduleName: m.name,
               compatible: ANY(et IN $elementTypes WHERE et IN cc.supportedTypes),
               countermeasureCount: cmCount
             }) AS classes,
             sum(cmCount) AS totalCm
        OPTIONAL MATCH (ctrl)-[:SUPPORTS]->(elem)
        WITH ctrl, classes, totalCm, collect(DISTINCT elem.id) AS assignedIds
        RETURN ctrl.id AS controlId, ctrl.name AS controlName,
               classes, totalCm AS totalCountermeasures, assignedIds AS assignedElementIds
      `;

      const result = await session.executeRead(async (tx: any) => {
        return await tx.run(query, { elementTypes, moduleIds });
      });

      return result.records.map((record: any) => {
        const classes = (record.get('classes') || []).map((cls: any) => ({
          classId: cls.classId,
          className: cls.className,
          moduleId: cls.moduleId,
          moduleName: cls.moduleName,
          compatible: cls.compatible,
          countermeasureCount:
            typeof cls.countermeasureCount?.toNumber === 'function'
              ? cls.countermeasureCount.toNumber()
              : cls.countermeasureCount,
        }));

        const totalCountermeasures = record.get('totalCountermeasures');

        return {
          controlId: record.get('controlId'),
          controlName: record.get('controlName'),
          classes,
          totalCountermeasures:
            typeof totalCountermeasures?.toNumber === 'function'
              ? totalCountermeasures.toNumber()
              : totalCountermeasures,
          assignedElementIds: (record.get('assignedElementIds') || []).filter(
            (id: any) => id !== null,
          ),
        };
      });
    } finally {
      await session.close();
    }
  }

  // --- Resolver registration ---

  getResolvers() {
    return {
      Query: {
        controlCandidatesForType: async (
          _parent: any,
          args: { elementTypes: string[]; moduleIds?: string[] },
          context: any,
        ) => {
          const startTime = Date.now();
          const authContext =
            this.authorizationService.extractAuthContext(context);

          const authResult =
            await this.authorizationService.checkAuthorization(authContext, {
              operationType: 'query',
              operationName: 'controlCandidatesForType',
              resourceType: 'Control',
            });

          if (!authResult.allowed) {
            throw new Error(
              `Authorization denied: ${authResult.reason || 'insufficient permissions'}`,
            );
          }

          try {
            const moduleIds = args.moduleIds ?? [];
            const result = await this.executeControlCandidatesForType(
              args.elementTypes,
              moduleIds,
            );
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'controlCandidatesForType',
              duration,
              success: true,
              timestamp: new Date(),
              metadata: {
                elementTypes: args.elementTypes,
                moduleIdCount: moduleIds.length,
                candidateCount: result.length,
              },
            });

            this.logger.debug('controlCandidatesForType completed', {
              elementTypes: args.elementTypes,
              moduleIdCount: moduleIds.length,
              candidateCount: result.length,
              duration,
            });

            return result;
          } catch (error) {
            const duration = Date.now() - startTime;

            this.monitoringService.recordOperation({
              operationName: 'controlCandidatesForType',
              duration,
              success: false,
              timestamp: new Date(),
              metadata: {
                elementTypes: args.elementTypes,
                error: safeErrorMessage(error),
              },
            });

            this.logger.error('controlCandidatesForType failed', {
              error: safeErrorMessage(error),
              elementTypes: args.elementTypes,
              duration,
            });

            throw error;
          }
        },
      },
    };
  }
}
