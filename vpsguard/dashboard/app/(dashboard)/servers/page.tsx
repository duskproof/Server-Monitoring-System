import type { Metadata } from 'next';

import { ServersView } from '@/components/servers/ServersView';

export const metadata: Metadata = {
  title: 'Servers',
};

export default function ServersPage() {
  return <ServersView />;
}
