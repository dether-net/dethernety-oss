/**
 * Data items schema for Dethernety threat models.
 *
 * Data items represent the types of data that flow through the system.
 * They are referenced by components and data flows to indicate what
 * data is processed or transmitted.
 *
 * Examples: "User Credentials", "Payment Information", "API Keys"
 */

import type {
  UUID,
  ClassReference,
  Identifiable,
  Attributes,
} from './common.schema.js';

/**
 * Data item representing a type of data in the system.
 *
 * Data items can be classified (e.g., "Customer PII", "Credentials")
 * and have attributes defined by their class.
 */
export interface DataItem extends Identifiable {
  /** Class assigned to this data item for categorization */
  classData?: ClassReference;

  /**
   * Inline attributes for the data item.
   * In split-file format, this may be empty with attributes stored separately.
   */
  attributes?: Attributes;
}

/**
 * Data items collection - the content of `data-items.json`.
 */
export interface DataItemsFile {
  /** All data items in the model */
  dataItems: DataItem[];
}

/**
 * Data item reference with additional context.
 * Used when showing where a data item is used.
 */
export interface DataItemUsage {
  /** The data item */
  dataItem: DataItem;
  /** Components that process this data */
  componentIds: UUID[];
  /** Boundaries that contain this data */
  boundaryIds: UUID[];
  /** Data flows that carry this data */
  dataFlowIds: UUID[];
}

/**
 * Build a map of data item usage across the model.
 */
export function buildDataItemUsageMap(
  dataItems: DataItem[],
  componentDataItems: Map<UUID, UUID[]>,
  boundaryDataItems: Map<UUID, UUID[]>,
  flowDataItems: Map<UUID, UUID[]>
): Map<UUID, DataItemUsage> {
  const usageMap = new Map<UUID, DataItemUsage>();

  for (const dataItem of dataItems) {
    const usage: DataItemUsage = {
      dataItem,
      componentIds: [],
      boundaryIds: [],
      dataFlowIds: [],
    };

    // Find components using this data item
    for (const [componentId, itemIds] of componentDataItems) {
      if (itemIds.includes(dataItem.id)) {
        usage.componentIds.push(componentId);
      }
    }

    // Find boundaries using this data item
    for (const [boundaryId, itemIds] of boundaryDataItems) {
      if (itemIds.includes(dataItem.id)) {
        usage.boundaryIds.push(boundaryId);
      }
    }

    // Find flows using this data item
    for (const [flowId, itemIds] of flowDataItems) {
      if (itemIds.includes(dataItem.id)) {
        usage.dataFlowIds.push(flowId);
      }
    }

    usageMap.set(dataItem.id, usage);
  }

  return usageMap;
}

/**
 * Find orphaned data items (not used by any element).
 */
export function findOrphanedDataItems(
  dataItems: DataItem[],
  usageMap: Map<UUID, DataItemUsage>
): DataItem[] {
  return dataItems.filter(item => {
    const usage = usageMap.get(item.id);
    if (!usage) return true;
    return (
      usage.componentIds.length === 0 &&
      usage.boundaryIds.length === 0 &&
      usage.dataFlowIds.length === 0
    );
  });
}

/**
 * Group data items by their class.
 */
export function groupDataItemsByClass(
  dataItems: DataItem[]
): Map<string, DataItem[]> {
  const groups = new Map<string, DataItem[]>();

  for (const item of dataItems) {
    const classKey = item.classData?.name ?? 'Unclassified';
    const existing = groups.get(classKey) ?? [];
    existing.push(item);
    groups.set(classKey, existing);
  }

  return groups;
}
