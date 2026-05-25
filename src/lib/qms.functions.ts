import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generateBundle, type ProjectData } from "./generation.server";
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
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, status, current_step, updated_at, workspace_id")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
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
    if (!data.scope) {
      const ds = ((project.department_scope as unknown) as string[]) ?? [];
      if (ds.length) {
        scope = "department";
        targets = ds;
      }
    }
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
      const result = await generateBundle(project as unknown as ProjectData, selected);
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

      return {
        run_id: run.id,
        documents: result.entries.length,
        path,
        findings: result.findings.length,
      };
    } catch (e: any) {
      await supabase
        .from("generation_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: String(e?.message || e),
        })
        .eq("id", run.id);
      throw e;
    }
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
      .select("template_code, status, created_at, run_id")
      .eq("project_id", data.project_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return rows ?? [];
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
