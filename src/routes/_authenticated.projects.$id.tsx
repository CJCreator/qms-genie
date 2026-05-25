import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getProject,
  saveProject,
  startGeneration,
  listGenerationRuns,
  getBundleUrl,
  listFindings,
  planGeneration,
  listGeneratedDocuments,
  getDocumentUrl,
} from "@/lib/qms.functions";
import { DEPARTMENTS, TEMPLATES, TEMPLATES_BY_CODE, directDependencies } from "@/lib/templates";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Building2,
  Cpu,
  ListChecks,
  FileText,
  Download,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Sparkles,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$id")({
  component: ProjectPage,
});

type Project = any;

const STEPS = [
  { n: 1, label: "Organisation Profile", icon: Building2 },
  { n: 2, label: "Device Portfolio", icon: Cpu },
  { n: 3, label: "Department Scope", icon: ListChecks },
  { n: 4, label: "Department Inputs", icon: FileText },
];

function ProjectPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const get = useServerFn(getProject);
  const save = useServerFn(saveProject);
  const runs = useServerFn(listGenerationRuns);
  const start = useServerFn(startGeneration);
  const bundleUrl = useServerFn(getBundleUrl);
  const findingsFn = useServerFn(listFindings);
  const planFn = useServerFn(planGeneration);
  const docsFn = useServerFn(listGeneratedDocuments);
  const docUrlFn = useServerFn(getDocumentUrl);

  const projectQ = useQuery({ queryKey: ["project", id], queryFn: () => get({ data: { id } }) });
  const runsQ = useQuery({
    queryKey: ["runs", id],
    queryFn: () => runs({ data: { project_id: id } }),
    refetchInterval: 4000,
  });
  const findingsQ = useQuery({
    queryKey: ["findings", id],
    queryFn: () => findingsFn({ data: { project_id: id } }),
    refetchInterval: 6000,
  });
  const docsQ = useQuery({
    queryKey: ["docs", id],
    queryFn: () => docsFn({ data: { project_id: id } }),
    refetchInterval: 6000,
  });

  const [step, setStep] = useState(1);
  const [org, setOrg] = useState<any>({});
  const [devices, setDevices] = useState<any[]>([]);
  const [scope, setScope] = useState<string[]>([]);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [docFilter, setDocFilter] = useState("");

  useEffect(() => {
    const p = projectQ.data as Project;
    if (!p) return;
    setStep(p.current_step || 1);
    setOrg(p.organisation_profile || {});
    setDevices(p.device_portfolio?.length ? p.device_portfolio : [{ name: "", classification: "", intended_use: "" }]);
    setScope(p.department_scope || []);
    setInputs(p.department_inputs || {});
  }, [projectQ.data]);

  const saveM = useMutation({
    mutationFn: async (patch: any) =>
      save({
        data: {
          id,
          organisation_profile: org,
          device_portfolio: devices,
          department_scope: scope,
          department_inputs: inputs,
          current_step: step,
          ...patch,
        },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["project", id] }),
  });

  const genM = useMutation({
    mutationFn: async (args?: { scope: "all" | "department" | "document"; targets?: string[] }) => {
      await saveM.mutateAsync({});
      return start({ data: { project_id: id, ...(args ?? {}) } });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["runs", id] });
      qc.invalidateQueries({ queryKey: ["findings", id] });
      qc.invalidateQueries({ queryKey: ["docs", id] });
    },
  });

  async function previewPlan(scopeType: "all" | "department" | "document", targets: string[]) {
    const p = await planFn({ data: { scope: scopeType, targets } });
    alert(
      `${p.total} documents will be generated.\nAuto-added via dependencies: ${p.added_by_dependency.length}\n\nCodes:\n${p.codes.join(", ")}`,
    );
  }

  async function download(run_id: string) {
    const { url } = await bundleUrl({ data: { run_id } });
    window.open(url, "_blank");
  }

  if (projectQ.isLoading || !projectQ.data) {
    return <p className="text-sm text-muted-foreground">Loading project…</p>;
  }

  const p: any = projectQ.data;
  const selectedTplCount = scope.length === 0 ? TEMPLATES.length : TEMPLATES.filter((t) => scope.includes(t.meta.department)).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/" className="text-xs text-muted-foreground hover:underline">← Back to projects</Link>
          <h1 className="text-2xl font-semibold mt-1">{p.name}</h1>
        </div>
        <Badge variant="secondary">{p.status}</Badge>
      </div>

      {/* Stepper */}
      <div className="flex gap-2">
        {STEPS.map((s) => {
          const Icon = s.icon;
          const active = step === s.n;
          return (
            <button
              key={s.n}
              onClick={() => setStep(s.n)}
              className={`flex-1 px-3 py-2 rounded-md border text-left text-sm flex items-center gap-2 ${
                active ? "border-primary bg-primary/5" : "bg-background"
              }`}
            >
              <Icon className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`} />
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Step {s.n}</div>
                <div className="truncate font-medium">{s.label}</div>
              </div>
            </button>
          );
        })}
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Organisation profile</CardTitle>
            <CardDescription>Used in every document header and approval block.</CardDescription>
          </CardHeader>
          <CardContent className="grid sm:grid-cols-2 gap-3">
            <Field label="Legal name" v={org.legal_name} onChange={(v) => setOrg({ ...org, legal_name: v })} />
            <Field label="Short name" v={org.short_name} onChange={(v) => setOrg({ ...org, short_name: v })} />
            <Field label="Registered address" v={org.address} onChange={(v) => setOrg({ ...org, address: v })} />
            <Field label="Target markets (EU, US, UK…)" v={Array.isArray(org.markets) ? org.markets.join(", ") : org.markets} onChange={(v) => setOrg({ ...org, markets: v.split(",").map((s: string) => s.trim()).filter(Boolean) })} />
            <Field label="QA Manager name" v={org.qa_manager_name} onChange={(v) => setOrg({ ...org, qa_manager_name: v })} />
            <Field label="QA Director name" v={org.qa_director_name} onChange={(v) => setOrg({ ...org, qa_director_name: v })} />
            <Field label="Management representative" v={org.management_representative} onChange={(v) => setOrg({ ...org, management_representative: v })} />
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Device portfolio</CardTitle>
            <CardDescription>One or more medical devices in the scope of this QMS.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {devices.map((d, i) => (
              <div key={i} className="grid sm:grid-cols-2 gap-3 border rounded-md p-3">
                <Field label="Device name" v={d.name} onChange={(v) => setDevices(devices.map((x, j) => j === i ? { ...x, name: v } : x))} />
                <Field label="Model / version" v={d.model} onChange={(v) => setDevices(devices.map((x, j) => j === i ? { ...x, model: v } : x))} />
                <Field label="Classification (Class I/IIa/IIb/III)" v={d.classification} onChange={(v) => setDevices(devices.map((x, j) => j === i ? { ...x, classification: v } : x))} />
                <Field label="Device type (hardware/software/hims/combination)" v={d.type} onChange={(v) => setDevices(devices.map((x, j) => j === i ? { ...x, type: v } : x))} />
                <div className="sm:col-span-2">
                  <Label className="text-xs">Intended use</Label>
                  <Textarea value={d.intended_use || ""} onChange={(e) => setDevices(devices.map((x, j) => j === i ? { ...x, intended_use: e.target.value } : x))} />
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={() => setDevices([...devices, { name: "", classification: "", intended_use: "" }])}>
              + Add device
            </Button>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Department scope</CardTitle>
            <CardDescription>
              Pick the departments to include. Templates from selected departments will be generated.
              Leave all unchecked to include the full {TEMPLATES.length}-document set.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {DEPARTMENTS.map((d) => {
              const count = TEMPLATES.filter((t) => t.meta.department === d.code).length;
              const checked = scope.includes(d.code);
              return (
                <label key={d.code} className="flex items-center gap-3 border rounded-md p-3 cursor-pointer">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) =>
                      setScope(c ? [...scope, d.code] : scope.filter((x) => x !== d.code))
                    }
                  />
                  <div className="flex-1">
                    <div className="font-medium text-sm">{d.code} · {d.name}</div>
                    <div className="text-xs text-muted-foreground">{count} documents</div>
                  </div>
                </label>
              );
            })}
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Department inputs</CardTitle>
            <CardDescription>
              Optional free-text notes per department. Fed into AI enrichment context.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(scope.length ? scope : DEPARTMENTS.map((d) => d.code)).map((code) => (
              <div key={code}>
                <Label className="text-xs uppercase tracking-wide">{code}</Label>
                <Textarea
                  rows={2}
                  placeholder={`Key context / processes / risks for ${code}…`}
                  value={inputs[code] || ""}
                  onChange={(e) => setInputs({ ...inputs, [code]: e.target.value })}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <Button variant="outline" disabled={step === 1} onClick={() => { setStep(step - 1); saveM.mutate({}); }}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => saveM.mutate({})}>
            {saveM.isPending ? "Saving…" : "Save"}
          </Button>
          {step < 4 ? (
            <Button onClick={() => { setStep(step + 1); saveM.mutate({}); }}>
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={() =>
                genM.mutate({
                  scope: scope.length ? "department" : "all",
                  targets: scope,
                })
              }
              disabled={genM.isPending}
            >
              {genM.isPending ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Generating with dependencies…</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-1" /> Generate full set ({selectedTplCount})</>
              )}
            </Button>
          )}
        </div>
      </div>

      {genM.error && (
        <p className="text-sm text-destructive">{(genM.error as Error).message}</p>
      )}

      <Separator />

      {/* Targeted generation: per-department and per-document with cascading deps */}
      <Card>
        <CardHeader>
          <CardTitle>Generate a single department or document</CardTitle>
          <CardDescription>
            Every run automatically expands to include all dependent documents
            (QMS spine, governing procedures, upstream design / verification records)
            so cross-references and traceability stay in sync.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              By department
            </div>
            <div className="flex flex-wrap gap-2">
              {DEPARTMENTS.map((d) => (
                <div key={d.code} className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => genM.mutate({ scope: "department", targets: [d.code] })}
                    disabled={genM.isPending}
                  >
                    {d.code} · {d.name}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => previewPlan("department", [d.code])}
                    title="Preview the resolved dependency set"
                  >
                    ?
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">
              By document
            </div>
            <Input
              placeholder="Filter by code or name…"
              value={docFilter}
              onChange={(e) => setDocFilter(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-72 overflow-auto border rounded-md divide-y">
              {TEMPLATES.filter((t) => {
                if (!docFilter) return true;
                const q = docFilter.toLowerCase();
                return (
                  t.meta.document_code.toLowerCase().includes(q) ||
                  t.meta.document_name.toLowerCase().includes(q)
                );
              })
                .slice(0, 60)
                .map((t) => {
                  const deps = directDependencies(t.meta.document_code);
                  return (
                    <div
                      key={t.meta.document_code}
                      className="flex items-center justify-between px-3 py-2 text-sm gap-3"
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">
                          {t.meta.document_code} · {t.meta.document_name}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          Cascades into {deps.length} dependent docs · ISO {t.meta.iso_clauses.join(", ")}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={genM.isPending}
                        onClick={() =>
                          genM.mutate({
                            scope: "document",
                            targets: [t.meta.document_code],
                          })
                        }
                      >
                        <Sparkles className="h-3 w-3 mr-1" /> Generate + deps
                      </Button>
                    </div>
                  );
                })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        <h2 className="text-lg font-semibold mb-2">Generation runs</h2>
        {runsQ.data?.length ? (
          <div className="space-y-2">
            {runsQ.data.map((r: any) => (
              <Card key={r.id}>
                <CardContent className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      v{r.version} · <Badge variant="secondary">{r.status}</Badge>
                      {r.summary?.scope ? (
                        <span className="ml-2 text-xs text-muted-foreground">
                          scope: {r.summary.scope}
                          {r.summary?.targets?.length ? ` (${r.summary.targets.join(", ")})` : ""}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Started {new Date(r.started_at).toLocaleString()}
                      {r.summary?.documents ? ` · ${r.summary.documents} documents` : ""}
                      {r.summary?.findings ? ` · ${r.summary.findings} findings` : ""}
                      {r.error ? ` · ${r.error}` : ""}
                    </div>
                  </div>
                  {r.status === "succeeded" && r.bundle_path && (
                    <Button size="sm" variant="outline" onClick={() => download(r.id)}>
                      <Download className="h-4 w-4 mr-1" /> Download ZIP
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No runs yet — complete the wizard and click Generate.</p>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Consistency findings</h2>
        {findingsQ.data?.length ? (
          <div className="space-y-1">
            {findingsQ.data.map((f: any) => (
              <div
                key={f.id}
                className="text-xs border rounded-md px-3 py-2 flex items-start gap-2"
              >
                <Badge
                  variant={
                    f.severity === "error"
                      ? "destructive"
                      : f.severity === "warning"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {f.severity}
                </Badge>
                <div>
                  {f.document_code ? <strong>{f.document_code}: </strong> : null}
                  {f.message}
                  {f.field ? <span className="text-muted-foreground"> ({f.field})</span> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No findings recorded yet.</p>
        )}
      </div>
    </div>
  );
}

function Field({ label, v, onChange }: { label: string; v?: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={v || ""} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
