import type { NodeType } from '@mapskill/core/client';

export const NODE_ICON: Record<NodeType, string> = {
  page: '📄', layout: '🖼️', 'api-route': '⚡', 'server-action': '⚙️', component: '🧩',
  helper: '🔧', table: '🗄️', service: '☁️', test: '✅', config: '🔩', file: '📁',
};
