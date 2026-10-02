import Image from 'next/image';
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
      <section className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-gradient-to-br from-[#0b1220] via-[#0f2544] to-[#0b1220] p-10 text-slate-100 lg:flex">
        <div className="flex items-center gap-3">
          <Image src="/icon.svg" alt="" width={40} height={40} priority />
          <span className="text-lg font-semibold tracking-tight">VPSGuard</span>
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
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              Live metrics streamed over WebSocket
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              Threshold alerts to Telegram, Slack, e-mail and webhooks
            </li>
            <li className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
              Remote shell, systemd and Docker control
            </li>
          </ul>
        </div>

        <p className="text-xs text-slate-400">© {new Date().getFullYear()} VPSGuard</p>
      </section>

      <section className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <Image src="/icon.svg" alt="" width={36} height={36} priority />
            <span className="text-lg font-semibold tracking-tight text-content">VPSGuard</span>
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
