import type { Metadata } from 'next';
import { Suspense } from 'react';

import { ServerDetailView } from '@/components/server-detail/ServerDetailView';
import { Skeleton } from '@/components/ui/Skeleton';

export const metadata: Metadata = {
  title: 'Server details',
};

export default function ServerDetailPage({ params }: { params: { id: string } }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-5">
          <Skeleton className="h-28 w-full rounded-2xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      }
    >
      <ServerDetailView serverId={params.id} />
    </Suspense>
  );
}
