import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-8 text-center">
        <h1 className="text-lg font-semibold text-content">Page not found</h1>
        <p className="mt-2 text-sm text-muted">
          The page you are looking for does not exist or has been moved.
        </p>
        <Link
          href="/cabinet"
          className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg transition-colors hover:bg-primary/90"
        >
          Back to overview
        </Link>
      </div>
    </div>
  );
}
