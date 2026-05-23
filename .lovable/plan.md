
# ISO 13485 QMS Document Automation Platform

Production-leaning v1 covering wizard, generation engine, AI enrichment, validation, multi-workspace SaaS, and dashboard. Built on TanStack Start (React) + Lovable Cloud (Supabase Postgres/Auth/Storage/RLS) + Lovable AI Gateway (Gemini 3 Flash).

> Note: spec says Node/Express + PostgreSQL. We're using Lovable Cloud's equivalent — Supabase Postgres + RLS, with TanStack Start server functions replacing Express routes. Functionally equivalent, deployable today.

## 1. Architecture

```
Browser (React + Tailwind)
   │
   ▼
TanStack Start server functions  ── Lovable AI Gateway (Gemini 3 Flash)
   │
   ▼
Supabase (Postgres + RLS, Auth, Storage)
   │
   ▼
docx generator (docx-js)  →  ZIP (jszip)  →  Master index (exceljs)
```

- Frontend: TanStack Start, Tailwind, shadcn/ui, react-hook-form + zod, TanStack Query.
- Backend: `createServerFn` handlers (auth-gated). No Edge Functions.
- DB: Supabase, RLS scoped by `workspace_id`.
- AI: Lovable AI Gateway via AI SDK (`google/gemini-3-flash-preview`) for narrative enrichment + consistency checks.
- Document generation: `docx` (npm) for .docx, `exceljs` for master index .xlsx, `jszip` for bundle.

## 2. Data model (Supabase)

- `workspaces` — id, name, plan, created_at
- `workspace_members` — workspace_id, user_id, role (`owner|admin|editor|viewer`)
- `user_roles` (app-wide) using the recommended security-definer `has_role()` pattern
- `projects` — workspace_id, name, status, current_wizard_step, organisation_profile jsonb, device_portfolio jsonb, department_scope jsonb, department_inputs jsonb
- `document_templates` — code (e.g. `QP-001`), title, department, section, purpose, author_role, approver_role, retention, schema jsonb, body_template text
- `generated_documents` — project_id, template_code, version, status (`draft|enriched|validated|final`), content jsonb, docx_storage_path, generated_at
- `generation_runs` — project_id, status, started/finished_at, error, summary jsonb
- `validation_findings` — project_id, run_id, severity, document_code, field, message
- `audit_logs` — workspace_id, actor, action, target, payload

RLS: every table scoped via `workspace_id` (joined through `projects`) with `has_workspace_access(workspace_id, auth.uid())` security-definer function. `document_templates` is global read.

Storage bucket `qms-bundles` (workspace-scoped paths, signed URLs for download).

## 3. Wizard (4 stages)

Route: `/_authenticated/projects/$projectId/wizard/$step`. Each step autosaves to its jsonb column via a server fn; navigation gated by validity.

1. **Organisation Profile** — legal name, address, regulatory jurisdictions (EU MDR / FDA / UKCA / MDSAP / others), QMS scope statement, top management roster, sites.
2. **Device Portfolio** — per-product: name, type (HW / SW / HIMS), risk class (I / IIa / IIb / III), intended use, IEC 62304 software safety class, applicable standards (ISO 14971, IEC 60601, IEC 62366, HL7/FHIR/DICOM, etc.).
3. **Department Scope** — select from the 11 departments parsed from the framework (QMS, RD, RA, MFG, SW, HI, QC, SCM, CAPA, IA, HR). Selection drives which templates render.
4. **Department Inputs** — dynamic forms per selected department, fields derived from each template's `schema`. Includes responsible roles, KPIs, equipment lists, supplier criteria, complaint channels, audit cycle, training matrix.

## 4. Template + generation engine

- Parse the framework .docx (already done in plan mode) to extract 95 document records: code, title, department, purpose, author, approver, retention. Seed `document_templates` via a migration.
- Each template gets a hand-authored `schema` (zod) + `body_template` (Mustache/Handlebars-style with `{{org.name}}`, `{{device[0].name}}`, AI block markers `{{ai:section_id}}`).
- Generation pipeline per project:
  1. **Plan** — pick templates matching selected departments (filter 95 → N).
  2. **Render** — for each template, hydrate context from project jsonb. Resolve cross-doc references (e.g. Quality Manual links to all listed procedures).
  3. **Enrich** — server fn calls Lovable AI Gateway for each `{{ai:…}}` block: structured-output prompt produces the narrative paragraph (scope, policy statements, risk rationale). Batched, concurrency-limited.
  4. **Validate** — cross-doc consistency check (also AI-assisted via `Output.object`): document codes referenced exist; roles consistent; retention rules consistent; device names spelled identically; risk class same everywhere. Findings written to `validation_findings`.
  5. **Compile** — docx-js builds each .docx with proper styles, headers/footers (doc code, version, controlled-document marker), TOC, signature block.
  6. **Package** — exceljs master index (code, title, dept, author, approver, retention, file path); jszip bundles `/QP/…`, `/RD/…` etc.; upload zip to Storage; return signed URL.
- Progress streamed via polling `generation_runs` (simple, robust); status drawer in UI.

## 5. UI surfaces

- **Auth**: email/password + Google (Lovable broker). `/login`, `/signup`, `/reset-password`.
- **Workspace switcher** in header. Create workspace, invite members (email-based row in `workspace_members`).
- **Dashboard** (`/`): projects list, status chips, latest run, certification phase progress (1–9 from framework).
- **Project detail**: wizard tab, documents tab (grid of 95 templates, in-scope highlighted, status per doc), validation tab (findings grouped by severity), generation tab (run history + download).
- **Templates browser** (`/templates`): all 95 docs by department, search/filter, view raw template + schema.
- **Settings**: workspace, members, AI usage.
- Medical/regulatory design system: Tailwind tokens — clean white, navy `#0f2a4d` primary, teal accent, mono for doc codes, controlled-document watermark on previews.

## 6. Build order (single iteration)

1. Enable Lovable Cloud; create LOVABLE_API_KEY; install deps (`docx`, `exceljs`, `jszip`, `ai`, `@ai-sdk/openai-compatible`, `zod`, `handlebars`).
2. Migrations: tables, RLS, `has_role`/`has_workspace_access`, storage bucket.
3. Auth + workspace bootstrap (auto-create personal workspace on signup).
4. Seed `document_templates` with the 95 records parsed from framework doc; author body_templates + schemas per template (largest single piece of work).
5. Wizard routes + autosave server fns.
6. Generation engine server fns (render → enrich → validate → compile → package).
7. Dashboard, project detail, templates browser, validation viewer.
8. Polish: progress UI, signed-URL downloads, audit log entries, error toasts for AI 429/402.

## 7. Known limitations of v1

- AI enrichment is per-section, not full-document rewrite — keeps cost predictable.
- Validation covers structural/cross-reference checks; doesn't claim ISO conformance certification.
- Body templates for all 95 docs are authored to a professional baseline, but a QA expert review pass is recommended before regulatory submission.
- Notified body submission integrations, e-signature, and DMS workflow (review/approve cycles) are out of scope for v1.

## 8. Technical details

- Server fns live in `src/lib/*.functions.ts`; admin/service-role logic in `*.server.ts`.
- AI calls use `generateText` + `Output.object` with zod schemas; concurrency limited (`p-limit`, 4) to respect gateway rate limits.
- Generation runs are idempotent per `(project_id, version)`; re-runs bump version.
- Long generations (~30–90s for full 95-doc bundle) run inside one server fn invocation; if it approaches Cloudflare Worker CPU limits we'll shard into per-department server fns and stitch the ZIP in a finalize step.
- Storage paths: `qms-bundles/{workspace_id}/{project_id}/v{version}/bundle.zip`.

When you approve, I'll switch to build mode and execute steps 1–8 in order.
