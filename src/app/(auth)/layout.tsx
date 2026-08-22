export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">CalDef</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Nutrition tracking with an expenditure model that learns.
          </p>
        </div>
        {children}
      </div>
    </div>
  );
}
