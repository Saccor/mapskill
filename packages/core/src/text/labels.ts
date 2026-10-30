import type { Text, Zone } from '../model/types';

export const ZONE_LABELS: Record<Zone, Text> = {
  pages: { en: 'Pages', sv: 'Sidor' },
  blocks: { en: 'Building blocks', sv: 'Byggstenar' },
  server: { en: 'Server', sv: 'Server' },
  data: { en: 'Data', sv: 'Data' },
  shared: { en: 'Shared', sv: 'Delat' },
  outside: { en: 'Outside', sv: 'Utanför' },
  tests: { en: 'Tests', sv: 'Tester' },
};
