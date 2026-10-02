'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

const FIELD_CLASS =
  'w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-content placeholder:text-muted/70 ' +
  'transition-colors focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30 ' +
  'disabled:cursor-not-allowed disabled:opacity-60';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  icon?: ReactNode;
  containerClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, icon, className, containerClassName, id, ...props },
  ref,
) {
  const generatedId = useId();
  const inputId = id ?? generatedId;

  return (
    <div className={cn('w-full', containerClassName)}>
      {label ? (
        <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      <div className="relative">
        {icon ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">{icon}</span>
        ) : null}
        <input
          ref={ref}
          id={inputId}
          className={cn(FIELD_CLASS, icon && 'pl-9', error && 'border-danger focus:border-danger focus:ring-danger/30', className)}
          aria-invalid={error ? true : undefined}
          {...props}
        />
      </div>
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, className, id, ...props },
  ref,
) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <div className="w-full">
      {label ? (
        <label htmlFor={fieldId} className="mb-1.5 block text-xs font-medium text-muted">
          {label}
        </label>
      ) : null}
      <textarea
        ref={ref}
        id={fieldId}
        className={cn(FIELD_CLASS, 'min-h-[88px] resize-y', error && 'border-danger', className)}
        {...props}
      />
      {error ? (
        <p className="mt-1 text-xs text-danger">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
});

export function Checkbox({
  label,
  className,
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;

  return (
    <label htmlFor={fieldId} className={cn('flex cursor-pointer items-center gap-2 text-sm text-content', className)}>
      <input
        id={fieldId}
        type="checkbox"
        className="h-4 w-4 rounded border-line bg-bg text-primary accent-[hsl(var(--primary))] focus:ring-primary/40"
        {...props}
      />
      {label}
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className={cn('flex items-center gap-2.5', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-elevated border border-line',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
          )}
        />
      </button>
      {label ? <span className="text-sm text-content">{label}</span> : null}
    </label>
  );
}
