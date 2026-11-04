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

declare module '@dethernety/dt-core/flat-keys' {
  export {
    FLAT_KEY_MAX_INDEX,
    FLAT_KEY_MAX_LIST_SLOTS,
    FLAT_KEY_MAX_SEGMENTS,
    unflattenFlatKeys,
  } from '@dethernety/dt-core';
}
