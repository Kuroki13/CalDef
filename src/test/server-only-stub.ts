/**
 * Stub for the `server-only` package under Vitest.
 *
 * The real package throws when it is resolved through a browser condition,
 * which is exactly what makes it useful in the app — a client component that
 * imports server code fails the build. The test environment is jsdom, so it
 * would trip the same guard and make server modules untestable. Aliasing it
 * to nothing here keeps the build-time protection intact while letting the
 * unit tests import the modules it guards.
 */
export {};
