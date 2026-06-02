import { DtFileOpaModule } from '@dethernety/dt-module';
import { Logger } from '@nestjs/common';
import * as path from 'path';

/**
 * Dethernety General — file-based, Studio-compatible module.
 *
 * Class data lives in data/dethernety-general/ alongside the compiled JS.
 * The module registry instantiates with (driver, logger); this constructor
 * resolves moduleDataDir relative to its own file location.
 */
class DethernetyGeneralModule extends DtFileOpaModule {
  constructor(driver: any, logger: Logger) {
    const moduleName = 'dethernety-general';
    const moduleDataDir = path.resolve(__dirname, 'data');
    super(moduleDataDir, moduleName, driver, logger);
  }
}

export default DethernetyGeneralModule;
