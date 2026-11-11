/**
 * A platform export (the shape DtExportSplit returns) with every field class a
 * push writes, plus some it never writes: tests of the platform baseline and of
 * the push check start from it.
 */

import type { SplitModel } from '@dethernety/dt-core'

/** A platform export with every field class present. */
export function richExport(): SplitModel {
  return {
    manifest: {
      schemaVersion: '2.0.0',
      format: 'split',
      model: {
        id: 'm-1',
        name: 'Shop',
        description: 'A shop',
        defaultBoundaryId: 'b-root',
        scope: { compliance_drivers: ['PCI DSS'] },
        controls: [{ id: 'ctl-model', name: 'Model control' }],
      },
      files: { structure: 'structure.json', dataFlows: 'dataflows.json', dataItems: 'data-items.json', attributes: 'attributes' },
      modules: [{ id: 'mod-2', name: 'b' }, { id: 'mod-1', name: 'a' }],
      exportedAt: '2026-09-26T10:00:00.000Z',
    },
    structure: {
      defaultBoundary: {
        id: 'b-root',
        name: 'Root',
        boundaries: [
          {
            id: 'b-dmz',
            name: 'DMZ',
            positionX: 10,
            positionY: 20,
            dimensionsWidth: 300,
            dimensionsHeight: 200,
            dimensionsMinWidth: 50,
            classData: { id: 'cls-zone', name: 'Zone' },
            controls: [{ id: 'ctl-b' }],
            zone: 'dmz',
            domains: ['payments', 'identity'],
            planes: ['data', 'control'],
            conduits: [
              { peerId: 'b-int', peerName: 'Internal', direction: 'OUTBOUND', justification: 'api', controlRefs: ['c1'] },
              { peerId: 'b-ext', peerName: 'External', direction: 'INBOUND' },
            ],
            components: [
              {
                id: 'c-web',
                name: 'Web',
                type: 'PROCESS',
                positionX: 1,
                positionY: 2,
                classData: { id: 'cls-web', name: 'Web server' },
                controls: [{ id: 'ctl-2' }, { id: 'ctl-1' }],
                dataItemIds: ['d-2', 'd-1'],
                crownJewel: true,
                representedModel: { id: 'm-other' },
              },
            ],
          },
        ],
        components: [{ id: 'c-db', name: 'DB', type: 'STORE', positionX: 5, positionY: 6 }],
      },
    },
    dataFlows: [
      {
        id: 'f-1',
        name: 'Query',
        source: { id: 'c-web' },
        target: { id: 'c-db' },
        sourceHandle: 'right',
        targetHandle: 'left',
        controls: [{ id: 'ctl-f' }],
        dataItemIds: ['d-1'],
      },
    ],
    dataItems: [
      { id: 'd-1', name: 'Card', sensitivity: 'restricted', regulatory_flags: ['PCI', 'GDPR'] },
      { id: 'd-2', name: 'Name' },
    ],
    attributes: {
      components: {
        'c-web': { elementId: 'c-web', elementType: 'component', elementName: 'Web', classData: { id: 'cls-web', name: 'Web server' }, attributes: { tls: true }, modifiedAt: 't1' },
      },
      boundaries: {
        'b-dmz': { elementId: 'b-dmz', elementType: 'boundary', classData: { id: 'cls-zone', name: 'Zone' }, attributes: { ingress: 'waf' } },
      },
      dataFlows: {
        'f-1': { elementId: 'f-1', elementType: 'dataFlow', attributes: { encrypted: true } },
      },
      dataItems: {
        'd-1': { elementId: 'd-1', elementType: 'dataItem', attributes: { retention: '1y' } },
      },
    },
  } as unknown as SplitModel
}
