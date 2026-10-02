import type { ReactNode } from 'react';

/** Shared split-screen shell for the login and register screens. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <main className="flex min-h-[100dvh] flex-col lg:flex-row">
      <section className="brand-panel relative hidden flex-1 flex-col justify-between overflow-hidden p-10 text-slate-100 lg:flex">
        <div>
          <span className="brand-text text-lg">DuskProof Guard</span>
        </div>

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">
            Every server, every metric, one dashboard.
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-slate-300">
            Collect CPU, memory, disk, network, Docker and security telemetry from your entire fleet.
            Get notified before your users notice, and fix issues straight from the built-in terminal.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-slate-300">
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              Live metrics streamed over WebSocket
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              Threshold alerts to Telegram, Slack, e-mail and webhooks
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              Remote shell, systemd and Docker control
            </li>
          </ul>
        </div>

        <p className="text-xs text-slate-400">© {new Date().getFullYear()} DuskProof Guard</p>
      </section>

      <section className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <span className="brand-text text-lg">DuskProof Guard</span>
          </div>

          <h1 className="text-2xl font-semibold text-content">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>

          <div className="mt-7">{children}</div>

          <div className="mt-6 text-center text-sm text-muted">{footer}</div>
        </div>
      </section>
    </main>
  );
}
