import { Compass } from 'lucide-react';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <Compass className="h-6 w-6" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-content">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-colors hover:bg-primary/90"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
