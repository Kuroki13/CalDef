import { cn } from "@/lib/utils";

/**
 * The top of every screen: what this is, one line of context, and at most
 * one thing to do about it.
 *
 * One component so the title sits at the same height, in the same weight,
 * on every tab — the eye should not have to find it again after a
 * navigation.
 */
export function PageHeader({
  title,
  eyebrow,
  description,
  action,
  className,
}: {
  title: React.ReactNode;
  /** A short label above the title, e.g. the date. */
  eyebrow?: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-end justify-between gap-4", className)}>
      <div className="min-w-0 space-y-1">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="text-[1.75rem] leading-tight font-bold tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** A labelled figure. The label is small and quiet; the number is the point. */
export function Stat({
  label,
  value,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="eyebrow">{label}</dt>
      <dd className="figure mt-0.5 text-xl">{value}</dd>
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

/** Nothing here yet — said once, plainly, with the way forward next to it. */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
      {Icon ? (
        <span className="bg-accent text-accent-foreground flex size-11 items-center justify-center rounded-full">
          <Icon className="size-5" aria-hidden />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="font-semibold">{title}</p>
        {children ? (
          <p className="text-muted-foreground text-sm">{children}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
