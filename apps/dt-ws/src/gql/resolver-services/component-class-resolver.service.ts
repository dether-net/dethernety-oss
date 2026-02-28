import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRegistryService } from '../module-management-services/module-registry.service';

@Injectable()
export class ComponentClassResolverService {
  private readonly logger = new Logger(ComponentClassResolverService.name);

  constructor(
    @Inject('NEO4J_DRIVER') private readonly neo4jDriver: any,
    private readonly moduleRegistry: ModuleRegistryService,
  ) {}

  async getClassTemplate(id: string, module: any): Promise<string> {
    const moduleName = module.name;
    if (!moduleName) {
      return '';
    }
    const moduleInstance = this.moduleRegistry.getModuleByName(moduleName);
    if (!moduleInstance) {
      this.logger.warn(`No module found for name: ${moduleName}`);
      return '';
    }
    try {
      return await moduleInstance.getClassTemplate(id);
    } catch (err) {
      this.logger.warn(
        `Error fetching template from module ${moduleName}: ${err.message}`,
      );
      return '';
    }
  }

  getResolvers() {
    return {
      ComponentClass: {
        template: async ({ id, module }) => {
          return await this.getClassTemplate(id, module[0]);
        },
      },
      DataFlowClass: {
        template: async ({ id, module }) => {
          return await this.getClassTemplate(id, module[0]);
        },
      },
      SecurityBoundaryClass: {
        template: async ({ id, module }) => {
          return await this.getClassTemplate(id, module[0]);
        },
      },
      ControlClass: {
        template: async ({ id, module }) => {
          return await this.getClassTemplate(id, module[0]);
        },
      },
      DataClass: {
        template: async ({ id, module }) => {
          return await this.getClassTemplate(id, module[0]);
        },
      },
      IssueClass: {
        template: async ({ id, module }) => {
          return await this.getClassTemplate(id, module[0]);
        },
      },
    };
  }
}
