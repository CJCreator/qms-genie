# qms-genie — End-to-end review

Date: 2026-05-25

## Summary

This repository is a TypeScript React application (Vite) that provides an ISO 13485 QMS document generation platform. Core features:
- Browser UI built on TanStack React Start and React 19
- Server-side generation engine that renders ISO 13485 templates into .docx and an Excel master index and packages them into a ZIP
- Templates stored in JSON under `src/templates/iso13485/`
- User auth and storage via Supabase (client + server service-role client)
- AI enrichment via Lovable AI Gateway (external API)

## High-level architecture

- Client: React (Vite) UI using `@tanstack/react-start` for routing/server-fns
- Server: server entry at `src/server.ts` delegates to `@tanstack/react-start/server-entry`
- Start instance config is in `src/start.ts` (request middleware + function middleware such as `attachSupabaseAuth`)
- Document generation: `src/lib/generation.server.ts` — renders templates -> .docx (docx lib) + index workbook (ExcelJS) -> zipped with JSZip
- Templates & dependency graph: `src/lib/templates.ts` and `src/templates/iso13485/*.json`
- Auth integration: `src/integrations/supabase/*` (client, client.server, auth-attacher, auth-middleware)
- UI routes: `src/routes/*.tsx` (`login.tsx`, `_authenticated.*.tsx`, `__root.tsx`)
- Utility helpers: `src/lib/utils.ts`, `src/lib/error-page.ts`, `src/lib/error-capture.ts`

Flow when generating documents

1. UI triggers a server function to generate documents for a Project (selected document codes + project data).
2. `generateBundle(project, selectedCodes, onProgress?)` runs:
   - Pre-render validation (`validateBeforeRender`) — blocks if required organisation/project fields or dependency closure missing.
   - Render sections for each selected template (`renderSections`) — static, variable, AI-generated, clause_block, table_spec etc.
     - AI-generated content calls `callAI(...)` which uses LOVABLE_API_KEY to call `https://ai.gateway.lovable.dev/v1/chat/completions`.
   - Cross-reference rewriting (`rewriteCrossRefs`) to resolve {ref:CODE} placeholders across documents in the run.
   - Build .docx files (docx lib) and master Excel index (ExcelJS), bundle into ZIP (JSZip) and return buffers.

Key files and locations

- Entrypoints: `src/start.ts`, `src/server.ts`
- Generation engine: `src/lib/generation.server.ts`
- Template registry and graph: `src/lib/templates.ts` and `src/templates/iso13485/*.json`
- Supabase integration: `src/integrations/supabase/*` (client, client.server, auth-attacher, auth-middleware)
- UI routes: `src/routes/*.tsx` (`login.tsx`, `_authenticated.*.tsx`, `__root.tsx`)
- Utility helpers: `src/lib/utils.ts`, `src/lib/error-page.ts`, `src/lib/error-capture.ts`

Environment & secrets

Required environment variables (server and/or client):

- SUPABASE_URL
- SUPABASE_PUBLISHABLE_KEY (VITE_SUPABASE_PUBLISHABLE_KEY for client builds)
- SUPABASE_SERVICE_ROLE_KEY (server-only admin client)
- LOVABLE_API_KEY (optional — if missing AI enrichment falls back to placeholders/messages)

Notes:
- `SUPABASE_SERVICE_ROLE_KEY` must never be exposed to the browser. Use `src/integrations/supabase/client.server.ts` only on server.
- `Vite` may use `import.meta.env.VITE_...` for client env values.

Run & development

Available scripts (from `package.json`):

````bash
// filepath: package.json
// ...existing code...
{
    "scripts": {
      "dev": "vite dev",
      "build": "vite build",
      "build:dev": "vite build --mode development",
      "preview": "vite preview",
      "lint": "eslint .",
      "format": "prettier --write ."
    }
}
// ...existing code...
````

Recommended local dev steps (Linux / devcontainer):

```bash
# install (uses npm/yarn/pnpm as appropriate). repository has bun.lock but package.json scripts target npm/vite
npm install
# run dev server
npm run dev
```

If using Supabase locally, ensure `.env` or Vite env vars are set with the publishable key and URL. For server-only actions you also need the service role key.

Security & risk notes

- AI dependency: `callAI` requires `LOVABLE_API_KEY`. If not configured, generation returns explanatory placeholders — plan for secrets and rate limits.
- Supabase service role key grants full DB access — confirm it's only loaded on server and stored in CI secret storage.
- Generated files may contain placeholders if fields are missing; `validateBeforeRender` blocks on critical missing inputs but leaves warnings for non-blocking items.

Observations & suggestions

1. Add a top-level `README.md` describing quickstart, env vars, and a high-level architecture (use contents of this review).
2. Provide sample `.env.example` with required env names (no values) to make setup easier.
3. Add CI step to run `npm run lint` and at least basic unit tests for `generation.server.ts` logic (e.g. `validateBeforeRender`, `expandWithDependencies`).
4. Add a small integration test that runs `generateBundle` with a minimal project payload and a small set of template codes but with `LOVABLE_API_KEY` mocked/absent to assert fallback behaviour.
5. Consider limiting concurrency or adding a queue for large generation runs — `p-limit(3)` exists but consider server resource caps.
6. Ensure `.env` and Supabase migrations are properly handled in CI/CD; keep `SUPABASE_SERVICE_ROLE_KEY` in secrets only.

Where to look next for deeper review

- `src/lib/generation.server.ts` — core of the engine; review error handling, AI retry policy, and content sanitization.
- `src/lib/templates.ts` + the `src/templates/iso13485/*.json` files to validate template completeness and cross-dependencies.
- `src/integrations/supabase/*` for auth edge cases, token expiry handling, and RLS considerations.
- `src/routes/*` for flow of user actions and server function wiring.

If you'd like, I can:
- run the app locally in the container (requires setting env vars),
- add `README.md` and `.env.example`,
- create unit tests for `validateBeforeRender` and `rewriteCrossRefs`.

---
Generated by an automated repo scan on 2026-05-25.
