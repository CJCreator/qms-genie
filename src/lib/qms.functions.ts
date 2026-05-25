import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  generateBundle,
  PreRenderValidationError,
  validateBeforeRender,
  renderDocumentPreview,
  type ProjectData,
} from "./generation.server";

async function auditLog(
  action: string,
  target: string | null,
  payload: Record<string, any> | null,
  workspace_id: string | null,
  actor: string | null,
) {
  try {
    await supabaseAdmin.from("audit_logs").insert({
      action,
      target,
      payload: payload ?? {},
      workspace_id,
      actor,
    });
  } catch {
    // Best effort only.
  }
}
import {
  TEMPLATES,
  TEMPLATES_BY_CODE,
  expandWithDependencies,
  expandDepartments,
  directDependencies,
} from "./templates";

// Plan a generation: returns the resolved code list (with dep closure) for a UI preview.
export const planGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: { scope: "all" | "department" | "document"; targets?: string[] }) => d,
  )
  .handler(async ({ data }) => {
    const codes = resolveCodes(data.scope, data.targets ?? []);
    return {
      codes,
      total: codes.length,
      added_by_dependency: codes.filter(
        (c) => !(data.targets ?? []).includes(c),
      ),
    };
  });

function resolveCodes(
  scope: "all" | "department" | "document",
  targets: string[],
): string[] {
  if (scope === "all") {
    return expandWithDependencies(TEMPLATES.map((t) => t.meta.document_code));
  }
  if (scope === "department") {
    return expandDepartments(targets);
  }
  // single/multi document
  return expandWithDependencies(targets.filter((c) => TEMPLATES_BY_CODE[c]));
}


// List user's projects (in their workspaces).
export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspace_id?: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let q = supabase
      .from("projects")
      .select("id, name, status, current_step, updated_at, workspace_id")
      .order("updated_at", { ascending: false });
    if (data.workspace_id) q = q.eq("workspace_id", data.workspace_id);
    const { data: projects, error } = await q;
    if (error) throw new Error(error.message);
    return projects ?? [];
  });

export const getWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase.from("workspaces").select("id, name, plan");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; workspace_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .insert({ name: data.name, workspace_id: data.workspace_id, created_by: userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await auditLog(
      "create_project",
      row.id,
      { name: data.name },
      data.workspace_id,
      userId,
    );

    return row;
  });

export const getProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const saveProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      id: string;
      organisation_profile?: any;
      device_portfolio?: any;
      department_scope?: any;
      department_inputs?: any;
      current_step?: number;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { id, ...patch } = data;
    const { error } = await supabase.from("projects").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listGenerationRuns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("generation_runs")
      .select("id, status, version, started_at, finished_at, bundle_path, summary, error")
      .eq("project_id", data.project_id)
      .order("started_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const startGeneration = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      project_id: string;
      scope?: "all" | "department" | "document";
      targets?: string[];
      overrides?: Record<string, Record<string, string>>;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // load project (RLS scoped)
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.project_id)
      .single();
    if (pErr || !project) throw new Error(pErr?.message || "Project not found");

    // Resolve which documents to generate (with full dependency closure).
    // - scope=all: every template (default if no scope given and no dept selected)
    // - scope=department: every doc in the chosen departments + deps
    // - scope=document: the chosen document codes + deps
    // If no explicit scope is sent, fall back to the project's department_scope.
    let scope: "all" | "department" | "document" = data.scope ?? "all";
    let targets: string[] = data.targets ?? [];

    // Audit generation start.
    await auditLog(
      "start_generation",
      project.id,
      { scope, targets, project_name: project.name },
      project.workspace_id,
      userId,
    );
    const selected = resolveCodes(scope, targets);

    // next version
    const { data: prev } = await supabase
      .from("generation_runs")
      .select("version")
      .eq("project_id", data.project_id)
      .order("version", { ascending: false })
      .limit(1);
    const version = ((prev?.[0] as any)?.version ?? 0) + 1;

    const { data: run, error: rErr } = await supabase
      .from("generation_runs")
      .insert({
        project_id: data.project_id,
        created_by: userId,
        version,
        status: "rendering",
        progress: { done: 0, total: selected.length, scope, targets },
      })
      .select("id")
      .single();
    if (rErr || !run) throw new Error(rErr?.message || "Could not start run");

    try {
      const result = await generateBundle(
        project as unknown as ProjectData,
        selected,
        async (doneCount, totalCount, currentCode) => {
          // Best-effort progress write; never fail the run on a progress error.
          try {
            await supabaseAdmin
              .from("generation_runs")
              .update({
                progress: {
                  done: doneCount,
                  total: totalCount,
                  current: currentCode,
                  scope,
                  targets,
                },
              })
              .eq("id", run.id);
          } catch {}
        },
        data.overrides,
      );
      const path = `${data.project_id}/${run.id}.zip`;
      const { error: upErr } = await supabaseAdmin.storage
        .from("qms-bundles")
        .upload(path, result.zip, {
          contentType: "application/zip",
          upsert: true,
        });
      if (upErr) throw new Error(upErr.message);

      // Upload each .docx individually so the Document Repository can offer
      // per-document download and version history.
      const docRows: any[] = [];
      for (const e of result.entries) {
        const docPath = `${data.project_id}/${run.id}/${e.filename}`;
        const { error: dErr } = await supabaseAdmin.storage
          .from("qms-bundles")
          .upload(docPath, e.buffer, {
            contentType:
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            upsert: true,
          });
        if (dErr) throw new Error(dErr.message);
        docRows.push({
          run_id: run.id,
          project_id: data.project_id,
          template_code: e.code,
          status: "rendered",
          storage_path: docPath,
          content: { name: e.name, filename: e.filename },
        });
      }

      // Persist validation findings for the UI tab.
      if (result.findings.length) {
        await supabaseAdmin.from("validation_findings").insert(
          result.findings.map((f) => ({
            project_id: data.project_id,
            run_id: run.id,
            severity: f.severity,
            document_code: f.document_code,
            field: f.field ?? null,
            message: f.message,
          })),
        );
      }

      // Persist per-document records (status + storage path per code).
      await supabaseAdmin.from("generated_documents").insert(docRows);

      await supabase
        .from("generation_runs")
        .update({
          status: "succeeded",
          finished_at: new Date().toISOString(),
          bundle_path: path,
          summary: {
            documents: result.entries.length,
            codes: result.entries.map((e) => e.code),
            findings: result.findings.length,
            scope,
            targets,
          },
        })
        .eq("id", run.id);

      await auditLog(
        "complete_generation",
        project.id,
        { run_id: run.id, documents: result.entries.map((e) => e.code) },
        project.workspace_id,
        userId,
      );

      return {
        run_id: run.id,
        documents: result.entries.length,
        path,
        findings: result.findings.length,
      };
    } catch (e: any) {
      // Pre-render validator blocked the run — persist findings so the UI
      // shows the user exactly what to fix.
      if (e instanceof PreRenderValidationError) {
        await supabaseAdmin.from("validation_findings").insert(
          e.findings.map((f) => ({
            project_id: data.project_id,
            run_id: run.id,
            severity: f.severity,
            document_code: f.document_code,
            field: f.field ?? null,
            message: f.message,
          })),
        );
      }
      await supabase
        .from("generation_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: String(e?.message || e),
        })
        .eq("id", run.id);
      await auditLog(
        "fail_generation",
        project.id,
        { run_id: run.id, error: String(e?.message || e) },
        project.workspace_id,
        userId,
      );
      throw e;
    }
  });

// Pre-render validation preview (no AI calls, no DB writes). Lets the UI
// surface blocking issues before the user clicks Generate.
export const previewValidation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      project_id: string;
      scope?: "all" | "department" | "document";
      targets?: string[];
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error(error?.message || "Project not found");

    let scope: "all" | "department" | "document" = data.scope ?? "all";
    let targets: string[] = data.targets ?? [];
    if (!data.scope) {
      const ds = ((project.department_scope as unknown) as string[]) ?? [];
      if (ds.length) {
        scope = "department";
        targets = ds;
      }
    }
    const codes = resolveCodes(scope, targets);
    const findings = validateBeforeRender(project as unknown as ProjectData, codes);
    return {
      total: codes.length,
      findings,
      blocking: findings.filter((f) => f.severity === "error").length,
      warnings: findings.filter((f) => f.severity === "warning").length,
    };
  });

export const renderDocumentSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string; document_code: string; overrides?: Record<string, Record<string, string>> }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: project, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", data.project_id)
      .single();
    if (error || !project) throw new Error(error?.message || "Project not found");

    const sections = await renderDocumentPreview(project as unknown as ProjectData, data.document_code, data.overrides);
    return { sections };
  });

export const listFindings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("validation_findings")
      .select("id, severity, document_code, field, message, created_at, run_id")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listGeneratedDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { project_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: rows, error } = await supabase
      .from("generated_documents")
      .select("id, template_code, status, created_at, run_id, storage_path, content")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Join with run versions for "version history" view.
    const runIds = Array.from(new Set((rows ?? []).map((r: any) => r.run_id)));
    let versionMap: Record<string, number> = {};
    if (runIds.length) {
      const { data: rs } = await supabase
        .from("generation_runs")
        .select("id, version")
        .in("id", runIds);
      versionMap = Object.fromEntries((rs ?? []).map((r: any) => [r.id, r.version]));
    }
    return (rows ?? []).map((r: any) => ({
      ...r,
      version: versionMap[r.run_id] ?? null,
    }));
  });


export const getBundleUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { run_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: run, error } = await supabase
      .from("generation_runs")
      .select("bundle_path, project_id")
      .eq("id", data.run_id)
      .single();
    if (error || !run?.bundle_path) throw new Error("Bundle not found");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("qms-bundles")
      .createSignedUrl(run.bundle_path, 60 * 10);
    if (sErr || !signed) throw new Error(sErr?.message || "Signed URL failed");
    return { url: signed.signedUrl };
  });

export const getDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { document_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc, error } = await supabase
      .from("generated_documents")
      .select("storage_path, content, project_id")
      .eq("id", data.document_id)
      .single();
    if (error || !doc?.storage_path) throw new Error("Document not found");

    await auditLog(
      "download_document",
      data.document_id,
      { project_id: doc.project_id },
      null,
      userId,
    );

    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("qms-bundles")
      .createSignedUrl(doc.storage_path, 60 * 10);
    if (sErr || !signed) throw new Error(sErr?.message || "Signed URL failed");
    return { url: signed.signedUrl };
  });

export const listWorkspaceMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspace_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: members, error: membersErr } = await supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", data.workspace_id);
    if (membersErr) throw new Error(membersErr.message);

    const userIds = (members ?? []).map((m: any) => m.user_id);
    const { data: users, error: usersErr } = await supabaseAdmin
      .from<any>("auth.users")
      .select("id, email")
      .in("id", userIds);
    if (usersErr) throw new Error(usersErr.message);

    const userMap = Object.fromEntries((users ?? []).map((u: any) => [u.id, u.email]));
    return {
      members: (members ?? []).map((m: any) => ({
        user_id: m.user_id,
        email: userMap[m.user_id] ?? "unknown",
        role: m.role,
      })),
    };
  });

export const getWorkspaceRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspace_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: roleData, error } = await supabase.rpc("workspace_role", {
      _user_id: context.userId,
      _workspace_id: data.workspace_id,
    });
    if (error) throw new Error(error.message || "Unable to determine workspace role");
    return { role: String(roleData) };
  });

export const removeWorkspaceMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { workspace_id: string; user_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: currentRoleData, error: roleErr } = await supabase.rpc(
      "workspace_role",
      { _user_id: userId, _workspace_id: data.workspace_id },
    );
    if (roleErr) throw new Error(roleErr.message || "Unable to verify workspace permissions");
    const currentRole = String(currentRoleData);
    if (!["owner", "admin"].includes(currentRole)) {
      throw new Error("Only workspace owners or admins can remove members.");
    }

    const { error } = await supabase
      .from("workspace_members")
      .delete()
      .eq("workspace_id", data.workspace_id)
      .eq("user_id", data.user_id);
    if (error) throw new Error(error.message);

    await auditLog(
      "remove_member",
      data.user_id,
      { workspace_id: data.workspace_id },
      data.workspace_id,
      userId,
    );
    return { ok: true };
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      workspace_id: string;
      email: string;
      role?: "admin" | "editor" | "viewer";
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: currentRoleData, error: roleErr } = await supabase.rpc(
      "workspace_role",
      { _user_id: userId, _workspace_id: data.workspace_id },
    );
    if (roleErr) throw new Error(roleErr.message || "Unable to verify workspace permissions");
    const currentRole = String(currentRoleData);
    if (!["owner", "admin"].includes(currentRole)) {
      throw new Error("Only workspace owners or admins can invite members.");
    }

    const { data: users, error: usersErr } = await supabaseAdmin
      .from<any>("auth.users")
      .select("id, email")
      .eq("email", data.email);
    if (usersErr) throw new Error(usersErr.message);
    const user = Array.isArray(users) ? users[0] : undefined;
    if (!user) {
      throw new Error(`No existing account found for ${data.email}. Invitees must sign up first.`);
    }

    const { data: existing, error: existingErr } = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", data.workspace_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (existingErr) throw new Error(existingErr.message);
    if (existing) {
      throw new Error("This user is already a member of the workspace.");
    }

    const roleToInsert = data.role ?? "editor";
    const { error: insertErr } = await supabase.from("workspace_members").insert({
      workspace_id: data.workspace_id,
      user_id: user.id,
      role: roleToInsert,
    });
    if (insertErr) throw new Error(insertErr.message);

    await auditLog(
      "invite_member",
      user.id,
      { email: data.email, role: roleToInsert },
      data.workspace_id,
      userId,
    );

    return { ok: true };
  });

export const deleteProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("workspace_id")
      .eq("id", data.id)
      .single();
    if (pErr || !project) throw new Error(pErr?.message || "Project not found");

    try {
      const { data: files, error: listErr } = await supabaseAdmin.storage
        .from("qms-bundles")
        .list(data.id, { limit: 1000 });
      if (!listErr && Array.isArray(files) && files.length) {
        const paths = files.map((file: any) => `${data.id}/${file.name}`);
        await supabaseAdmin.storage.from("qms-bundles").remove(paths);
      }
    } catch {
      // best-effort cleanup only
    }

    const { error } = await supabase.from("projects").delete().eq("id", data.id);
    if (error) throw new Error(error.message);

    await auditLog(
      "delete_project",
      data.id,
      {},
      project.workspace_id ?? null,
      userId,
    );
    return { ok: true };
  });

// ============= Documents Repository (workspace-wide) =============

export const listWorkspaceDocuments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      workspace_id?: string;
      project_id?: string;
      status?: string;
      department?: string;
      q?: string;
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    let projectQ = supabase.from("projects").select("id, name, workspace_id");
    if (data.workspace_id) projectQ = projectQ.eq("workspace_id", data.workspace_id);
    if (data.project_id) projectQ = projectQ.eq("id", data.project_id);
    const { data: projects, error: pErr } = await projectQ;
    if (pErr) throw new Error(pErr.message);
    const projectIds = (projects ?? []).map((p: any) => p.id);
    if (!projectIds.length) return { documents: [], projects: [] };

    let q = supabase
      .from("generated_documents")
      .select(
        "id, template_code, status, created_at, run_id, storage_path, content, project_id, released_at, archived_at, superseded_by_id",
      )
      .in("project_id", projectIds)
      .order("template_code", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(2000);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const runIds = Array.from(new Set((rows ?? []).map((r: any) => r.run_id)));
    let versionMap: Record<string, number> = {};
    if (runIds.length) {
      const { data: rs } = await supabase
        .from("generation_runs")
        .select("id, version")
        .in("id", runIds);
      versionMap = Object.fromEntries((rs ?? []).map((r: any) => [r.id, r.version]));
    }
    const projectMap = Object.fromEntries(
      (projects ?? []).map((p: any) => [p.id, p.name]),
    );
    let docs = (rows ?? []).map((r: any) => ({
      ...r,
      version: versionMap[r.run_id] ?? null,
      project_name: projectMap[r.project_id] ?? "—",
    }));
    if (data.department) {
      docs = docs.filter((d: any) => d.template_code?.startsWith(data.department!));
    }
    if (data.q) {
      const qLower = data.q.toLowerCase();
      docs = docs.filter((d: any) => {
        const title = String(d.content?.name ?? "").toLowerCase();
        const projectName = String(projectMap[d.project_id] ?? "").toLowerCase();
        return (
          String(d.template_code ?? "").toLowerCase().includes(qLower) ||
          title.includes(qLower) ||
          projectName.includes(qLower)
        );
      });
    }
    return { documents: docs, projects: projects ?? [] };
  });

export const updateDocumentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      document_id: string;
      status: "rendered" | "released" | "superseded" | "obsolete";
    }) => d,
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc, error: docErr } = await supabase
      .from("generated_documents")
      .select("project_id, template_code, storage_path")
      .eq("id", data.document_id)
      .single();
    if (docErr || !doc) throw new Error(docErr?.message || "Document not found");

    const patch: any = { status: data.status };
    if (data.status === "released") {
      patch.released_at = new Date().toISOString();
      patch.released_by = userId;
    }
    const { error } = await supabase
      .from("generated_documents")
      .update(patch)
      .eq("id", data.document_id);
    if (error) throw new Error(error.message);

    await auditLog(
      "update_document_status",
      data.document_id,
      { status: data.status, template_code: doc.template_code },
      null,
      userId,
    );
    return { ok: true };
  });

export const archiveDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { document_id: string }) => d)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: doc, error: docErr } = await supabase
      .from("generated_documents")
      .select("template_code")
      .eq("id", data.document_id)
      .single();
    if (docErr || !doc) throw new Error(docErr?.message || "Document not found");

    const { error } = await supabase
      .from("generated_documents")
      .update({ status: "obsolete", archived_at: new Date().toISOString() })
      .eq("id", data.document_id);
    if (error) throw new Error(error.message);

    await auditLog(
      "archive_document",
      data.document_id,
      { template_code: doc.template_code },
      null,
      userId,
    );
    return { ok: true };
  });
