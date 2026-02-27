import { DtNeo4jOpaModule } from "@dethernety/dt-module";
import { Logger } from '@nestjs/common';

/**
 * Dethernety core module providing built-in classes for threat modeling.
 *
 * The DTModule node and class definitions are now managed via Cypher data
 * ingestion scripts (data/01-module.cypher, data/02-classes.cypher) that
 * run during module package installation.
 */
class DethernetyModule extends DtNeo4jOpaModule {
  constructor(driver: any, logger: Logger) {
    const moduleName = process.env.INTERNAL_MODULE_NAME || 'dethernety';
    super(moduleName, driver, logger);
  }
}

export default DethernetyModule;