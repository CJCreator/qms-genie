import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listProjects, getWorkspaces, createProject } from "@/lib/qms.functions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { FilePlus2, FolderOpen } from "lucide-react";

export const Route = createFileRoute("/_authenticated/")({
  component: Dashboard,
});

function Dashboard() {
  const list = useServerFn(listProjects);
  const ws = useServerFn(getWorkspaces);
  const create = useServerFn(createProject);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const projects = useQuery({ queryKey: ["projects"], queryFn: () => list() });
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: () => ws() });

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");

  const m = useMutation({
    mutationFn: async () => {
      const w = workspaces.data?.[0];
      if (!w) throw new Error("No workspace yet — refresh in a moment.");
      return create({ data: { name, workspace_id: w.id } });
    },
    onSuccess: (row) => {
      setOpen(false);
      setName("");
      qc.invalidateQueries({ queryKey: ["projects"] });
      if (row?.id) navigate({ to: "/projects/$id", params: { id: row.id } });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-muted-foreground">
            Each project produces a complete ISO 13485:2016 QMS document package.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <FilePlus2 className="h-4 w-4 mr-2" /> New project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create new project</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="pname">Project name</Label>
                <Input
                  id="pname"
                  placeholder="e.g. Acme HIMS v2 — EU MDR submission"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              {m.error && <p className="text-sm text-destructive">{(m.error as Error).message}</p>}
              <Button disabled={!name || m.isPending} onClick={() => m.mutate()}>
                {m.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {projects.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (projects.data?.length ?? 0) === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No projects yet. Create one to start the 4-step wizard.
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {projects.data!.map((p: any) => (
            <Link key={p.id} to="/projects/$id" params={{ id: p.id }} className="block">
              <Card className="hover:border-primary transition-colors">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <FolderOpen className="h-4 w-4 text-primary" /> {p.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground flex items-center justify-between">
                  <Badge variant="secondary">{p.status}</Badge>
                  <span>Step {p.current_step}/4</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
