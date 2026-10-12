// Test containers that publish their ports on the loopback interface only.
//
// testcontainers publishes an exposed port on every host interface (it sets only a HostPort, no
// HostIp), so a test database is reachable from the network for the length of the run. This
// subclass pins every published port to 127.0.0.1. Connect to LOOPBACK_HOST, not getHost():
// "localhost" can resolve to ::1 first, where nothing listens.

import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export const LOOPBACK_HOST = '127.0.0.1';

export class LoopbackContainer extends GenericContainer {
  public override async start(): Promise<StartedTestContainer> {
    const bindings = (this.hostConfig.PortBindings ?? {}) as Record<string, Array<{ HostIp?: string; HostPort?: string }>>;
    for (const port of Object.keys(bindings)) {
      bindings[port] = bindings[port].map((binding) => ({ ...binding, HostIp: LOOPBACK_HOST }));
    }
    this.hostConfig.PortBindings = bindings;
    return super.start();
  }
}
