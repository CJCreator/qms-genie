## Goal

Turn the QMS app from "structurally correct but content-thin" into a system that produces audit-ready documents, with a real Documents repository, proper validation, traceable cross-references, and complete multi-tenant hygiene.

Work is grouped into 5 phases. Each phase is independently shippable.

---

## Phase 1 — Content depth (highest regulatory impact)

The 95 JSON templates today are clones (one AI paragraph + scope line). This phase makes them real.

1. **Template schema upgrade** — extend `DocumentTemplate` to support richer section types: `table_spec` (column defs + AI-generated rows), `clause_block` (per ISO clause prompt), `risk_table` (ISO 14971 hazard / harm / P1 / P2 / risk index), `traceability_matrix`.
2. **Rewrite the 95 templates by document family**, not as clones:
   - **QP / QF** (Quality Procedures & Forms): full procedural sections per ISO clause cited.
   - **RD-007 Risk Management File**: ISO 14971 structure (scope, policy, analysis table, controls, residual risk, benefit-risk).
   - **SW-001..012**: IEC 62304 lifecycle structure (safety class, SOUP list, unit/integration/system test records, cybersecurity controls per FDA premarket guidance).
   - **RA-002 Technical File**: MDR Annex II / FDA 510(k) section map.
   - **MF / QC**: real inspection plans, calibration logs, sterilization records with the required parameter fields.
   - **CA**: CAPA procedure with 8D structure; vigilance per MDR Art. 87.
   - **HR / SC / AU / HI**: structured tables for matrices, schedules, supplier scoring.
3. **AI prompt per section**, not per document — each section_prompt becomes specific (e.g. "Generate a CAPA investigation table for a Class IIa software-as-medical-device complaint about …").
4. **Apply `output_config`** — `buildDocx` reads header/footer/page_size from the JSON and applies them to the DOCX section properties.
5. **Use the regulatory system prompt** from the Tech Supplement (load it from a `src/lib/regulatory-system-prompt.ts` constant) instead of the current 2-line prompt.

## Phase 2 — Cross-reference rewriter & real validator

1. **Two-pass generation**:
   - Pass 1: render every selected document's sections to plain text.
   - Build a registry: `{code → {name, sections: [{id, title, page?}]}}`.
   - Pass 2: resolve placeholders `{ref:CODE}` → `"CODE Name §section"` and `{role:qa_manager}` → name lookup, using the registry.
   - Then build DOCX.
2. **Consistency Validator** that runs BEFORE render and blocks (or warn-confirms) on:
   - Missing required org fields (legal name, QA Manager, QA Director, address, markets).
   - Missing device classification per market.
   - Role-name mismatches across templates.
   - ISO clause coverage gaps for the selected scope.
   - Markets vs `required_sections_for_markets` mismatches in each template.
3. **Streaming progress** — `startGeneration` writes incremental progress to `generation_runs.progress` (done/total/current_code). UI replaces the spinner with a live progress bar (already polling 4s).
4. **AI rate-limit hardening** — exponential backoff on 429/5xx, max 2 retries, bake `[AI unavailable — manual authoring required]` only on final failure.

## Phase 3 — Documents Repository (proper)

1. **New route** `src/routes/_authenticated.documents.tsx` — workspace-wide repository (cross-project), not buried in a project page.
2. **Server fns**: `listWorkspaceDocuments`, `searchDocuments` (server-side filter by code/dept/status/project/text), `updateDocumentStatus` (released / superseded / obsolete), `archiveDocument`.
3. **DB migration**: add `released_at`, `released_by`, `superseded_by_id` columns to `generated_documents`; backfill `status` enum (`rendered | released | superseded | obsolete`); add INSERT/UPDATE policies scoped via the project's workspace.
4. **UI**: table grouped by document code, expandable version history, version diff (text diff of the rendered section JSON we already store in `content`), per-doc download, lifecycle actions.
5. **Per-project filter** + `Link` from a project page into the repository pre-filtered to that project.

## Phase 4 — Audit log, workspace switcher, cleanup

1. **Audit log writes** — server fn helper `auditLog(action, target, payload)` called from every mutation: project create/update/delete, generation start/finish, document download, status change, member invite. Migration adds INSERT policy `with check (actor = auth.uid() and has_workspace_access(...))`.
2. **Workspace switcher** in the authenticated layout header — dropdown reading `getWorkspaces`, selected workspace persisted in URL search param / localStorage; project list filters by it.
3. **Member invite UI** — `inviteMember(workspace_id, email, role)` server fn (owner/admin only); pending invites table; accept-on-signup flow.
4. **Storage GC on project delete** — `deleteProject` removes all objects under `${project_id}/` in `qms-bundles`, then deletes child rows, then the project. Wrap in a Postgres function so it's atomic.

## Phase 5 — Wizard polish & one-click hero

1. **Zod validation per step** with inline errors; "Next" disabled until valid.
2. **Structured device fields**: classification per market (EU/US/UK), regulatory pathway, GMDN code, software safety class (A/B/C), predicate device, sterile y/n + method.
3. **Structured per-department inputs** (not a free textarea): small forms (e.g. CAPA escalation thresholds, supplier criticality tiers, sterilization params, cleanroom class).
4. **Hero CTA** on the project page top: "Generate complete QMS package (95 docs)" once wizard valid.
5. **Generation preview modal** — show the resolved code list, AI call count, estimated time, before kicking off.

---

## Technical notes

- Templates live in `src/templates/iso13485/*.json`. Phase 1 rewrites these in place; the loader (`src/lib/templates.ts`) requires no change beyond the schema upgrade.
- Cross-ref rewriter and richer renderer go in `src/lib/generation.server.ts` (split into `render.ts` / `rewrite.ts` / `validate.ts` if it grows).
- New routes follow file-based convention: `_authenticated.documents.tsx`, `_authenticated.workspace.tsx`.
- All DB changes via `supabase--migration`. Data backfills via `supabase--insert`.
- AI calls stay on Lovable AI Gateway; model upgraded to `google/gemini-2.5-pro` for content-heavy sections, `gemini-2.5-flash` for short purpose blocks (cost/latency balance).

## Suggested execution order

I'd recommend shipping in this order, with your approval gate between each:

1. **Phase 2 first** (validator + cross-ref + streaming progress) — small surface, immediate trust win.
2. **Phase 1** (template depth) — biggest user-visible value, longest work; do it in 3 sub-batches by department family.
3. **Phase 3** (Documents repository) — once content is real, the repo is worth navigating.
4. **Phase 4** (audit log + workspace switcher + GC) — compliance hygiene.
5. **Phase 5** (wizard polish) — last because it depends on knowing the final input contract from Phase 1.

Approve and I'll start with Phase 2.