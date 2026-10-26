import { probeEngine } from '@dethernety/dt-module';
import type { DatabaseService } from '../../src/database/database.service';

/**
 * The engine lookup a service gets from DatabaseService, answered by probing
 * a test container's driver directly.
 */
export function engineSource(driver: unknown): DatabaseService {
  return { getEngineInfoStrict: () => probeEngine(driver) } as unknown as DatabaseService;
}
