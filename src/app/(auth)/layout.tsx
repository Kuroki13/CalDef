export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="flex items-center justify-center gap-2 text-3xl font-bold tracking-tight">
            <span aria-hidden className="bg-primary size-3 rounded-full" />
            CalDef
          </h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Nutrition tracking with an expenditure model that learns.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
