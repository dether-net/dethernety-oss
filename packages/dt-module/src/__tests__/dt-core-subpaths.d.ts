// dt-core is ESM-only and serves its pure modules by subpath. This package's tsc resolution does not read
// package `exports`, so the subpath a test imports is declared here against the barrel's types.
declare module '@dethernety/dt-core/operation-determination' {
  export {
    OPERATION_OPERATOR_KEY,
    OPERATION_PRODUCT_KEY,
    OPERATION_VERSION_KEY,
    RESERVED_ATTRIBUTE_PREFIX,
    OPERATOR_VALUES,
    OPERATION_FIELD_KEYS,
    OPERATION_CATEGORY_LABEL,
  } from '@dethernety/dt-core';
}
