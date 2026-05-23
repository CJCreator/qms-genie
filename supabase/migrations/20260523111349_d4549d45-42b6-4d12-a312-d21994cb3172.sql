
-- Enums
create type workspace_role as enum ('owner','admin','editor','viewer');
create type project_status as enum ('draft','in_progress','generated','archived');
create type run_status as enum ('queued','rendering','enriching','validating','packaging','succeeded','failed');
create type finding_severity as enum ('info','warning','error');

-- Workspaces
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null,
  role workspace_role not null default 'editor',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members(user_id);

-- Security definer: membership check (avoids RLS recursion)
create or replace function public.has_workspace_access(_workspace_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from workspace_members where workspace_id = _workspace_id and user_id = _user_id);
$$;

create or replace function public.workspace_role(_workspace_id uuid, _user_id uuid)
returns workspace_role language sql stable security definer set search_path = public as $$
  select role from workspace_members where workspace_id = _workspace_id and user_id = _user_id;
$$;

-- Projects
create table projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  status project_status not null default 'draft',
  current_step int not null default 1,
  organisation_profile jsonb not null default '{}'::jsonb,
  device_portfolio jsonb not null default '[]'::jsonb,
  department_scope jsonb not null default '[]'::jsonb,
  department_inputs jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on projects(workspace_id);

-- Document templates (global library, seeded by app)
create table document_templates (
  code text primary key,
  department text not null,
  title text not null,
  purpose text not null,
  author_role text not null,
  approver_role text not null,
  retention text not null,
  section_spec jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index on document_templates(department);

-- Generation runs
create table generation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  version int not null,
  status run_status not null default 'queued',
  progress jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error text,
  bundle_path text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid not null
);
create index on generation_runs(project_id);

-- Generated documents
create table generated_documents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references generation_runs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  template_code text not null references document_templates(code),
  status text not null default 'rendered',
  content jsonb not null default '{}'::jsonb,
  storage_path text,
  created_at timestamptz not null default now()
);
create index on generated_documents(run_id);
create index on generated_documents(project_id);

-- Validation findings
create table validation_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references generation_runs(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  severity finding_severity not null,
  document_code text,
  field text,
  message text not null,
  created_at timestamptz not null default now()
);
create index on validation_findings(run_id);

-- Audit log
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  actor uuid,
  action text not null,
  target text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on audit_logs(workspace_id);

-- updated_at trigger
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger trg_projects_touch before update on projects for each row execute function touch_updated_at();

-- Auto-create personal workspace on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare ws_id uuid;
begin
  insert into workspaces (name, created_by) values (coalesce(new.raw_user_meta_data->>'full_name','My') || ' Workspace', new.id) returning id into ws_id;
  insert into workspace_members (workspace_id, user_id, role) values (ws_id, new.id, 'owner');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Enable RLS
alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table projects enable row level security;
alter table document_templates enable row level security;
alter table generation_runs enable row level security;
alter table generated_documents enable row level security;
alter table validation_findings enable row level security;
alter table audit_logs enable row level security;

-- Policies: workspaces
create policy "members read workspaces" on workspaces for select to authenticated using (has_workspace_access(id, auth.uid()));
create policy "users create workspaces" on workspaces for insert to authenticated with check (created_by = auth.uid());
create policy "owners admins update workspaces" on workspaces for update to authenticated using (workspace_role(id, auth.uid()) in ('owner','admin'));
create policy "owners delete workspaces" on workspaces for delete to authenticated using (workspace_role(id, auth.uid()) = 'owner');

-- Policies: workspace_members
create policy "members read membership" on workspace_members for select to authenticated using (has_workspace_access(workspace_id, auth.uid()));
create policy "owners admins manage members" on workspace_members for insert to authenticated with check (workspace_role(workspace_id, auth.uid()) in ('owner','admin'));
create policy "owners admins update members" on workspace_members for update to authenticated using (workspace_role(workspace_id, auth.uid()) in ('owner','admin'));
create policy "owners admins delete members" on workspace_members for delete to authenticated using (workspace_role(workspace_id, auth.uid()) in ('owner','admin'));

-- Policies: projects
create policy "members read projects" on projects for select to authenticated using (has_workspace_access(workspace_id, auth.uid()));
create policy "editors create projects" on projects for insert to authenticated with check (has_workspace_access(workspace_id, auth.uid()) and created_by = auth.uid());
create policy "editors update projects" on projects for update to authenticated using (workspace_role(workspace_id, auth.uid()) in ('owner','admin','editor'));
create policy "admins delete projects" on projects for delete to authenticated using (workspace_role(workspace_id, auth.uid()) in ('owner','admin'));

-- Policies: document_templates (global read for authenticated)
create policy "auth read templates" on document_templates for select to authenticated using (true);

-- Policies: generation_runs / generated_documents / findings (scoped via project->workspace)
create policy "members read runs" on generation_runs for select to authenticated using (exists (select 1 from projects p where p.id = project_id and has_workspace_access(p.workspace_id, auth.uid())));
create policy "members create runs" on generation_runs for insert to authenticated with check (exists (select 1 from projects p where p.id = project_id and has_workspace_access(p.workspace_id, auth.uid())) and created_by = auth.uid());
create policy "members update runs" on generation_runs for update to authenticated using (exists (select 1 from projects p where p.id = project_id and has_workspace_access(p.workspace_id, auth.uid())));

create policy "members read docs" on generated_documents for select to authenticated using (exists (select 1 from projects p where p.id = project_id and has_workspace_access(p.workspace_id, auth.uid())));

create policy "members read findings" on validation_findings for select to authenticated using (exists (select 1 from projects p where p.id = project_id and has_workspace_access(p.workspace_id, auth.uid())));

create policy "members read audit" on audit_logs for select to authenticated using (workspace_id is null or has_workspace_access(workspace_id, auth.uid()));

-- Storage bucket for generated bundles
insert into storage.buckets (id, name, public) values ('qms-bundles','qms-bundles', false) on conflict (id) do nothing;

create policy "members read bundles" on storage.objects for select to authenticated
  using (
    bucket_id = 'qms-bundles'
    and exists (
      select 1 from projects p
      where p.id::text = split_part(name, '/', 2)
        and has_workspace_access(p.workspace_id, auth.uid())
    )
  );
