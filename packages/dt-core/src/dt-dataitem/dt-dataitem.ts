import { DtUtils } from '../dt-utils/dt-utils.js'
import { gql } from 'graphql-tag'
import * as Apollo from '@apollo/client'
import { DataItem } from '../interfaces/core-types-interface.js'
import { ADD_DATA_ITEM, UPDATE_DATA_ITEM, DELETE_DATA_ITEM } from './dt-dataitem-gql.js'
import { DtClass, ChangeElementBindingResult } from '../dt-class/dt-class.js'
import { localEnumToPlatform, SENSITIVITY_LEVELS } from '../schemas/index.js'

/**
 * Bundled-method return shape: the residual UPDATE_DATA_ITEM surfaces
 * `dataItem`, the binding portion of the call surfaces `bindingResult`.
 * `bindingResult` is null when `classId` was omitted from the call (no
 * binding change attempted). `residualOk` is the boolean view of the
 * residual mutation.
 */
export interface UpdateDataItemResult {
  dataItem: DataItem | null
  bindingResult: ChangeElementBindingResult | null
  residualOk: boolean
}

export class DtDataItem {
  private dtUtils: DtUtils
  private dtClass: DtClass
  private apolloClient: Apollo.ApolloClient

  constructor(apolloClient: Apollo.ApolloClient) {
    this.apolloClient = apolloClient
    this.dtUtils = new DtUtils(this.apolloClient)
    this.dtClass = new DtClass(this.apolloClient)
  }

  /**
   * Create a new data item
   * @param name - The name of the data item
   * @param description - The description of the data item
   * @param classId - The ID of the class of the data item
   * @param elementId - The ID of the element of the data item
   * @param modelId - The ID of the model of the data item
   * @returns The created data item
   */
  createDataItem = async (
    { name, description, classId, elementId, modelId, sensitivity, regulatoryFlags }:
    { name: string, description: string, elementId: string, classId: string | null, modelId: string, sensitivity?: string, regulatoryFlags?: string[] }
  ): Promise<DataItem | null> => {
    try {
      // Asset-context on create: set present fields only (fresh node, nothing to
      // clear). Sensitivity validated + uppercased; an unknown value is dropped
      // (warned) rather than sending an invalid enum. Flags are free-text.
      const platformSensitivity = localEnumToPlatform(sensitivity, SENSITIVITY_LEVELS)
      const assetContext = {
        ...(platformSensitivity ? { sensitivity: platformSensitivity } : {}),
        ...(regulatoryFlags?.length ? { regulatoryFlags } : {}),
      }
      const variables = {
        input: [{
          name,
          description,
          ...assetContext,
          model: {
            connect: {
              where: {
                node: { id: { eq: modelId } },
              },
            },
          },
          component: {
            connect: {
              where: {
                node: { id: { eq: elementId } },
              },
            },
          },
          dataFlow: {
            connect: {
              where: {
                node: { id: { eq: elementId } },
              },
            },
          },
          securityBoundary: {
            connect: {
              where: {
                node: { id: { eq: elementId } },
              },
            },
          },
          // elements: {
          //   connect: {
          //     where: {
          //       node: { id: { eq: elementId } }
          //     }
          //   }
          // },
          dataClass: classId ? {
            connect: {
              where: {
                node: { id: { eq: classId } },
              },
            },
          } : {},
        }],
      }
      
      const result = await this.dtUtils.performMutation<DataItem>({
        mutation: ADD_DATA_ITEM,
        variables,
        dataPath: 'createData.data[0]',
        action: 'createDataItem',
        deduplicationKey: `create-dataitem-${elementId}-${name}-${modelId}`
      })
      
      if (result) {
        return {
          ...result,
          dataClass: result.dataClass && Array.isArray(result.dataClass) && result.dataClass.length > 0
            ? result.dataClass[0]
            : result.dataClass,
        }
      }
      return null
    } catch (error) {
      throw error
    }
  }

  /**
   * Update a data item. Bundled method: when `classId` is part of the call
   * (truthy or explicit null), the binding portion routes through
   * {@link DtClass.changeElementBinding} first; the residual UPDATE_DATA_ITEM
   * mutation then handles name / description / attributes. The atomic backend
   * transaction owns class-derived finding cleanup, so the legacy
   * `dataClass` connect/disconnect on the residual is gone.
   *
   * @param classId - When truthy: targets CLASS kind. When null: targets NONE.
   *   When `undefined` (omitted): no binding change attempted; `bindingResult`
   *   returned as null. Backend identity-short-circuits if unchanged.
   * @returns UpdateDataItemResult — both halves observable.
   */
  updateDataItem = async (
    { dataItemId, name, description, classId, attributes: _attributes, sensitivity, regulatoryFlags }:
    {
      dataItemId: string | null,
      name?: string,
      description?: string,
      classId?: string | null,
      attributes?: object,
      // `null` is a CLEAR and `undefined` is "leave it alone" — the two used to be the same value here,
      // which is what let a caller wipe a classification it had never been asked to touch.
      sensitivity?: string | null,
      regulatoryFlags?: string[],
    }
  ): Promise<UpdateDataItemResult> => {
    if (!dataItemId) {
      return { dataItem: null, bindingResult: null, residualOk: false }
    }

    let bindingResult: ChangeElementBindingResult | null = null
    if (classId !== undefined) {
      try {
        bindingResult = await this.dtClass.changeElementBinding({
          elementId: dataItemId,
          target: classId
            ? { kind: 'CLASS', classIds: [classId] }
            : { kind: 'NONE' },
        })
      } catch (error) {
        this.dtUtils.handleError({ action: 'updateDataItem:changeElementBinding', error })
        return { dataItem: null, bindingResult: null, residualOk: false }
      }

      if (bindingResult.errorCode) {
        return { dataItem: null, bindingResult, residualOk: false }
      }
    }

    try {
      // A field the caller does not supply is not written. That contract used to hold for none of these
      // four, and the asset-context pair was the expensive half: an absent value CLEARED the platform
      // field, which is what a full sync means by absence and the opposite of what an interactive save
      // means by it. The clear is still available and now has to be said — a `null` sensitivity or an
      // empty flag list — rather than arrived at by leaving the field out.
      //
      // The input can legitimately end up with no keys at all, when a save changes only the class
      // binding above. That still goes to the server: the caller needs the row back to re-pin its copy,
      // and an update naming no field returns it unchanged.
      const variables = {
        dataId: dataItemId,
        input: {
          ...(name !== undefined && { name: { set: name } }),
          ...(description !== undefined && { description: { set: description } }),
          // Sensitivity is validated and uppercased; an unknown value drops to null with a warning,
          // which is a clear rather than a rejection because the value came from a file somebody edited.
          ...(sensitivity !== undefined && {
            sensitivity: { set: localEnumToPlatform(sensitivity, SENSITIVITY_LEVELS) ?? null },
          }),
          ...(regulatoryFlags !== undefined && { regulatoryFlags: { set: regulatoryFlags } }),
        },
      }

      const result = await this.dtUtils.performMutation<DataItem>({
        mutation: UPDATE_DATA_ITEM,
        variables,
        dataPath: 'updateData.data[0]',
        action: 'updateDataItem',
        // The key carries WHICH FIELDS are being written, not just which item. Deduplication joins an
        // in-flight request under the same key and returns its result — right for a double submit of one
        // act, wrong for two different ones. A class pick fires a save without awaiting it, so a Save
        // pressed during that one would otherwise join it and never be written.
        deduplicationKey: `update-dataitem-${dataItemId}-${Object.keys(variables.input).sort().join('.')}`
      })

      if (result) {
        const dataItem: DataItem = {
          ...result,
          dataClass: result.dataClass && Array.isArray(result.dataClass) && result.dataClass.length > 0
            ? result.dataClass[0]
            : result.dataClass,
        }
        return { dataItem, bindingResult, residualOk: true }
      }
      return { dataItem: null, bindingResult, residualOk: false }
    } catch (error) {
      this.dtUtils.handleError({ action: 'updateDataItem:residual', error })
      return { dataItem: null, bindingResult, residualOk: false }
    }
  }

  /**
   * Delete a data item
   * @param dataItemId - The ID of the data item to delete
   * @returns True if the data item was deleted, false otherwise
   */
  deleteDataItem = async ({ dataItemId }: { dataItemId: string }): Promise<boolean> => {
    try {
      const variables = { dataId: dataItemId }
      const result = await this.dtUtils.performMutation<any>({
        mutation: DELETE_DATA_ITEM,
        variables,
        dataPath: '',
        action: 'deleteDataItem',
        deduplicationKey: false // Disable deduplication for delete operations
      })
      
      return Boolean(result)
    } catch (error) {
      return false
    }
  }

}