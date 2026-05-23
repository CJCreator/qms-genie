import { createFileRoute, redirect } from "@tanstack/react-router";

// Public root just redirects into the authenticated app shell;
// the _authenticated layout handles login redirection.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/" as any, replace: true, mask: { to: "/" } } as any);
  },
  component: () => null,
});
