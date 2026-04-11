import { DtFileOpaModule } from '@dethernety/dt-module';
import { Logger } from '@nestjs/common';
import * as path from 'path';

/**
 * Dethernety core module — file-based, Studio-generated classes.
 *
 * Class data lives in data/dethernety-module/ alongside the compiled JS.
 * The module registry instantiates with (driver, logger); this constructor
 * resolves moduleDataDir relative to its own file location.
 */
class DethernetyModule extends DtFileOpaModule {
  constructor(driver: any, logger: Logger) {
    const moduleName = 'dethernety-module';

    // Resolve data dir relative to compiled JS location.
    // Installed layout: custom_modules/dethernety-module/DethernetyModule.js
    //                   custom_modules/dethernety-module/data/dethernety-module/
    const moduleDataDir = path.resolve(__dirname, 'data');

    super(moduleDataDir, moduleName, driver, logger);
  }
}

export default DethernetyModule;
