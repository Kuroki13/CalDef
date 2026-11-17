import { cn } from "@/lib/utils";

/**
 * The top of a screen that has no slab: its name in the display face, one
 * line of context, and at most one thing to do about it.
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
    <header className={cn("flex items-end justify-between gap-4 pt-5 lg:pt-10", className)}>
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1 className="display text-4xl break-words lg:text-5xl">{title}</h1>
        {description ? (
          <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/**
 * The slab: the ink block at the top of a screen that carries its numbers.
 *
 * On a phone it runs edge to edge and continues the top bar, with rounded
 * lower corners; on desktop it is a rounded block in the page. Everything
 * inside reads against ink (`on-slab`). One per screen.
 */
export function Slab({
  children,
  className,
  size = "hero",
}: {
  children: React.ReactNode;
  className?: string;
  /**
   * How much of the screen the numbers deserve. `hero` is Today's: the
   * figure is the screen. `strip` is for a screen whose point is the list
   * or the chart underneath — a band of figures, then the content.
   */
  size?: "hero" | "strip";
}) {
  return (
    <section
      className={cn(
        "on-slab -mx-4 lg:mx-0 lg:mt-10",
        size === "hero"
          ? "rounded-b-[1.75rem] px-5 pt-3 pb-6 lg:rounded-[1.75rem] lg:p-8"
          : "rounded-b-3xl px-4 pt-1 pb-4 lg:rounded-3xl lg:p-6",
        className,
      )}
    >
      {children}
    </section>
  );
}

/** A thin bar on the slab. `tone` says what is being measured. */
export function SlabBar({
  value,
  tone = "plain",
  className,
  label,
}: {
  /** 0–100. */
  value: number;
  tone?: "volt" | "plain";
  className?: string;
  label: string;
}) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      className={cn("bg-slab-line h-1.5 overflow-hidden rounded-full", className)}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500",
          tone === "volt" ? "bg-volt" : "bg-slab-foreground",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

/** A section's name, with an optional action on the right. */
export function SectionTitle({
  children,
  action,
  id,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-3">
      <h2 id={id} className="display text-2xl">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** A labelled figure. The label is small and quiet; the number is the point. */
export function Stat({
  label,
  value,
  unit,
  hint,
  className,
}: {
  label: string;
  value: React.ReactNode;
  /** Printed small after the figure — a number never stands without one. */
  unit?: string;
  hint?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="eyebrow">{label}</dt>
      <dd className="figure mt-1 text-3xl">
        {value}
        {unit ? (
          <span className="ml-1 font-sans text-sm font-medium opacity-65">{unit}</span>
        ) : null}
      </dd>
      {hint ? <p className="mt-1 text-xs opacity-70">{hint}</p> : null}
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
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-dashed px-5 py-6">
      {Icon ? (
        <span className="bg-slab text-volt flex size-10 items-center justify-center rounded-full">
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
