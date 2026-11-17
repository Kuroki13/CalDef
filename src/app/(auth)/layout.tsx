import { Wordmark } from "@/components/app-nav";

/**
 * Signing in, in the app's own look: the ink slab with the wordmark and
 * what the app is for, then the form on paper.
 */
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="on-slab pt-safe rounded-b-[1.75rem] px-6 pb-10">
        <div className="mx-auto w-full max-w-sm pt-10">
          <Wordmark className="text-3xl" />
          <p className="display mt-8 text-5xl leading-[0.9]">
            Meals.
            <br />
            Weight.
            <br />
            <span className="text-volt">Training.</span>
          </p>
          <p className="text-slab-muted mt-4 text-sm">
            Track your meals, your weight and your training — and see where
            they are taking you.
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-sm flex-1 px-4 py-8">{children}</main>
    </div>
  );
}
