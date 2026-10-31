import type { NodeType, Zone } from './types';

/** Which zone of the map each kind of part lives in. */
export const ZONE_OF_TYPE: Record<NodeType, Zone> = {
  page: 'pages',
  layout: 'pages',
  'api-route': 'server',
  'server-action': 'server',
  config: 'server',
  component: 'blocks',
  helper: 'shared',
  file: 'shared',
  table: 'data',
  service: 'outside',
  test: 'tests',
};
