import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  listWorkspaceDocuments,
  updateDocumentStatus,
  archiveDocument,
  getDocumentUrl,
} from "@/lib/qms.functions";
import { TEMPLATES_BY_CODE, DEPARTMENTS } from "@/lib/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ChevronDown,
  ChevronRight,
  Download,
  CheckCircle2,
  Archive,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/documents")({
  component: DocumentsPage,
  validateSearch: (s: Record<string, unknown>) => ({
    project_id: typeof s.project_id === "string" ? s.project_id : undefined,
  }),
});

const STATUS_COLORS: Record<string, string> = {
  rendered: "bg-blue-100 text-blue-800",
  released: "bg-green-100 text-green-800",
  superseded: "bg-amber-100 text-amber-800",
  obsolete: "bg-gray-200 text-gray-700",
};

function DocumentsPage() {
  const { project_id } = Route.useSearch();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [department, setDepartment] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>(project_id ?? "all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const fetchDocs = useServerFn(listWorkspaceDocuments);
  const updateStatus = useServerFn(updateDocumentStatus);
  const archiveDoc = useServerFn(archiveDocument);
  const getUrl = useServerFn(getDocumentUrl);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["workspace-documents", status, department, projectFilter, q],
    queryFn: () =>
      fetchDocs({
        data: {
          project_id: projectFilter !== "all" ? projectFilter : undefined,
          status: status !== "all" ? status : undefined,
          department: department !== "all" ? department : undefined,
          q: q || undefined,
        },
      }),
  });

  const statusMut = useMutation({
    mutationFn: (args: { document_id: string; status: any }) =>
      updateStatus({ data: args }),
    onSuccess: () => {
      toast.success("Status updated");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });
  const archiveMut = useMutation({
    mutationFn: (id: string) => archiveDoc({ data: { document_id: id } }),
    onSuccess: () => {
      toast.success("Document archived");
      refetch();
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Group documents by template_code → versions (already ordered desc by created_at)
  const grouped = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const d of data?.documents ?? []) {
      if (!map.has(d.template_code)) map.set(d.template_code, []);
      map.get(d.template_code)!.push(d);
    }
    // Local text search over title too
    const term = q.trim().toLowerCase();
    return Array.from(map.entries())
      .filter(([code]) => {
        if (!term) return true;
        const t = TEMPLATES_BY_CODE[code];
        return (
          code.toLowerCase().includes(term) ||
          t?.meta.document_name.toLowerCase().includes(term)
        );
      })
      .sort(([a], [b]) => a.localeCompare(b));
  }, [data, q]);

  async function download(id: string) {
    try {
      const { url } = await getUrl({ data: { document_id: id } });
      window.open(url, "_blank");
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" /> Documents Repository
          </h1>
          <p className="text-sm text-muted-foreground">
            Every generated QMS document across your workspaces with full version history.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Input
          placeholder="Search by code or title…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="rendered">Rendered</SelectItem>
            <SelectItem value="released">Released</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
            <SelectItem value="obsolete">Obsolete</SelectItem>
          </SelectContent>
        </Select>
        <Select value={department} onValueChange={setDepartment}>
          <SelectTrigger><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {DEPARTMENTS.map((d) => (
              <SelectItem key={d.code} value={d.code}>{d.code} — {d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger><SelectValue placeholder="Project" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All projects</SelectItem>
            {(data?.projects ?? []).map((p: any) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Latest status</TableHead>
              <TableHead>Versions</TableHead>
              <TableHead>Project</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">Loading…</TableCell></TableRow>
            )}
            {!isLoading && grouped.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">No documents match these filters.</TableCell></TableRow>
            )}
            {grouped.map(([code, versions]) => {
              const latest = versions[0];
              const tpl = TEMPLATES_BY_CODE[code];
              const isOpen = !!expanded[code];
              return (
                <Fragment key={code}>
                  <TableRow className="hover:bg-muted/40">
                    <TableCell>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => setExpanded((s) => ({ ...s, [code]: !isOpen }))}
                      >
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{code}</TableCell>
                    <TableCell className="font-medium">{tpl?.meta.document_name ?? latest.content?.name ?? code}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_COLORS[latest.status] ?? ""} variant="secondary">{latest.status}</Badge>
                    </TableCell>
                    <TableCell>{versions.length}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{latest.project_name}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => download(latest.id)}>
                          <Download className="h-4 w-4" />
                        </Button>
                        {latest.status !== "released" && (
                          <Button size="sm" variant="ghost" title="Mark released"
                            onClick={() => statusMut.mutate({ document_id: latest.id, status: "released" })}>
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          </Button>
                        )}
                        {latest.status !== "obsolete" && (
                          <Button size="sm" variant="ghost" title="Archive"
                            onClick={() => archiveMut.mutate(latest.id)}>
                            <Archive className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow className="bg-muted/30">
                      <TableCell></TableCell>
                      <TableCell colSpan={6}>
                        <div className="text-xs font-medium mb-2 text-muted-foreground">Version history</div>
                        <div className="space-y-1">
                          {versions.map((v: any) => (
                            <div key={v.id} className="flex items-center justify-between text-sm border-b last:border-0 py-1">
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-xs">v{v.version ?? "?"}</span>
                                <Badge className={STATUS_COLORS[v.status] ?? ""} variant="secondary">{v.status}</Badge>
                                <span className="text-muted-foreground">{new Date(v.created_at).toLocaleString()}</span>
                                <Link
                                  to="/projects/$id"
                                  params={{ id: v.project_id }}
                                  className="text-xs text-primary hover:underline"
                                >
                                  {v.project_name}
                                </Link>
                              </div>
                              <div className="flex gap-1">
                                <Button size="sm" variant="ghost" onClick={() => download(v.id)}>
                                  <Download className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
