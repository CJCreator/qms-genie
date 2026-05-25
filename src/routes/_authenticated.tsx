import { createFileRoute, Outlet, useNavigate, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  getWorkspaces,
  inviteMember,
  listWorkspaceMembers,
  getWorkspaceRole,
  removeWorkspaceMember,
} from "@/lib/qms.functions";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ShieldCheck, FileCheck2, FolderOpen, LogOut } from "lucide-react";

export const Route = createFileRoute("/_authenticated")({
  component: AuthLayout,
  validateSearch: (s: Record<string, unknown>) => ({
    workspace_id: typeof s.workspace_id === "string" ? s.workspace_id : undefined,
  }),
});

function AuthLayout() {
  const navigate = useNavigate();
  const router = useRouter();
  const { workspace_id } = Route.useSearch();
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(workspace_id ?? null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "editor" | "viewer">("editor");
  const [membersOpen, setMembersOpen] = useState(false);

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => getWorkspaces(),
    enabled: ready,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate({ to: "/login" });
      } else {
        setEmail(data.session.user.email ?? null);
        setUserId(data.session.user.id ?? null);
        setReady(true);
      }
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!session) navigate({ to: "/login" });
      else setEmail(session.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, [navigate]);

  useEffect(() => {
    if (workspace_id) {
      setWorkspaceId(workspace_id);
      window.localStorage.setItem("workspace_id", workspace_id);
      return;
    }
    const saved = window.localStorage.getItem("workspace_id");
    if (saved) {
      setWorkspaceId(saved);
      const params = new URLSearchParams(window.location.search);
      params.set("workspace_id", saved);
      window.history.replaceState({}, "", `${window.location.pathname}?${params}`);
    }
  }, [workspace_id]);

  if (!ready) {
    return <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  async function signOut() {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/login" });
  }

  const workspaceRoleFn = useServerFn(getWorkspaceRole);
  const membersFn = useServerFn(listWorkspaceMembers);
  const removeMemberFn = useServerFn(removeWorkspaceMember);

  const workspaceRoleQuery = useQuery({
    queryKey: ["workspace-role", workspaceId],
    queryFn: async () =>
      workspaceRoleFn({ data: { workspace_id: workspaceId ?? "" } }),
    enabled: ready && !!workspaceId,
  });

  const membersQuery = useQuery({
    queryKey: ["workspace-members", workspaceId],
    queryFn: async () =>
      membersFn({ data: { workspace_id: workspaceId ?? "" } }),
    enabled: ready && !!workspaceId && membersOpen,
  });

  const canManageMembers =
    workspaceRoleQuery.data?.role === "owner" || workspaceRoleQuery.data?.role === "admin";

  const inviteMutation = useMutation({
    mutationFn: async () =>
      inviteMember({
        data: {
          workspace_id: workspaceId ?? "",
          email: inviteEmail,
          role: inviteRole,
        },
      }),
    onSuccess: () => {
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRole("editor");
      membersQuery.refetch();
      window.alert("Invitation recorded.");
    },
    onError: (error: any) => {
      window.alert(error.message ?? "Failed to invite member.");
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) =>
      removeMemberFn({ data: { workspace_id: workspaceId ?? "", user_id: memberId } }),
    onSuccess: () => {
      membersQuery.refetch();
      window.alert("Member removed.");
    },
    onError: (error: any) => {
      window.alert(error.message ?? "Failed to remove member.");
    },
  });

  return (
    <div className="min-h-screen bg-muted/20">
      <header className="border-b bg-background">
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-5 w-5 text-primary" />
              ISO 13485 QMS Platform
            </Link>
            <Select value={workspaceId ?? "all"} onValueChange={(value) => {
              const next = value === "all" ? null : value;
              setWorkspaceId(next);
              if (next) {
                window.localStorage.setItem("workspace_id", next);
              } else {
                window.localStorage.removeItem("workspace_id");
              }
              const params = new URLSearchParams(window.location.search);
              if (next) params.set("workspace_id", next);
              else params.delete("workspace_id");
              window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? `?${params}` : ""}`);
            }}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Workspace" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All workspaces</SelectItem>
                {workspacesQuery.data?.map((ws: any) => (
                  <SelectItem key={ws.id} value={ws.id}>{ws.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Dialog open={membersOpen} onOpenChange={setMembersOpen}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMembersOpen(true)}
                disabled={!workspaceId}
              >
                Workspace members
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Workspace members</DialogTitle>
                  <DialogDescription>
                    Review who has access to the current workspace and their roles.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-2 mt-4">
                  {membersQuery.isLoading && (
                    <div className="text-sm text-muted-foreground">Loading members…</div>
                  )}
                  {membersQuery.isError && (
                    <div className="text-sm text-destructive">{(membersQuery.error as any)?.message || "Unable to load members."}</div>
                  )}
                  {membersQuery.data?.members?.length === 0 && !membersQuery.isLoading && (
                    <div className="text-sm text-muted-foreground">No members yet for this workspace.</div>
                  )}
                  {membersQuery.data?.members?.map((member: any) => (
                    <div key={member.user_id} className="rounded-lg border p-3 bg-muted/60">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="font-medium">{member.email}</div>
                          <div className="text-sm text-muted-foreground">{member.role}</div>
                        </div>
                        {canManageMembers && member.user_id !== userId && (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => removeMutation.mutate(member.user_id)}
                            disabled={removeMutation.isLoading}
                          >
                            Remove
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <DialogFooter>
                  <Button
                    variant="secondary"
                    onClick={() => setInviteOpen(true)}
                    disabled={!workspaceId || !canManageMembers}
                  >
                    Invite another member
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setInviteOpen(true)}
                disabled={!workspaceId || !canManageMembers}
              >
                Invite member
              </Button>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Invite a workspace member</DialogTitle>
                  <DialogDescription>
                    Enter the email of the user you want to add to the current workspace.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 mt-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Email</label>
                    <Input
                      value={inviteEmail}
                      onChange={(event) => setInviteEmail(event.target.value)}
                      placeholder="user@example.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700">Role</label>
                    <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as any)}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    disabled={!inviteEmail || inviteMutation.isLoading || !workspaceId}
                    onClick={() => inviteMutation.mutate()}
                  >
                    Send invite
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            <Link to="/documents" className="text-muted-foreground hover:text-foreground flex items-center gap-1">
              <FolderOpen className="h-4 w-4" /> Documents
            </Link>
            <Link to="/templates" className="text-muted-foreground hover:text-foreground flex items-center gap-1">
              <FileCheck2 className="h-4 w-4" /> Templates
            </Link>
            <span className="text-muted-foreground hidden sm:inline">{email}</span>
            <Button size="sm" variant="ghost" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-1" /> Sign out
            </Button>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
