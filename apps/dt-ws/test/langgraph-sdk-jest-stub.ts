// Jest stub for `@langchain/langgraph-sdk`. The real package transitively
// pulls in pure-ESM modules (`p-retry`, `is-network-error`) that the dt-ws
// jest setup cannot load (CommonJS). Tests that actually need to drive the
// SDK provide their own jest.mock with the methods they care about; this
// stub satisfies the import barrel for tests that don't touch the SDK at all
// (the hot path for module-registry tests).

export class Client {
  assistants = {
    search: async () => [],
    get: async () => ({}),
    create: async () => ({}),
    update: async () => ({}),
    delete: async () => undefined,
  };
  runs = {};
  threads = {};
  store = {};
  constructor(_opts?: unknown) {}
}
