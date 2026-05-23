import { createFileRoute } from "@tanstack/react-router";
import { TEMPLATES, DEPARTMENTS } from "@/lib/templates";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/templates")({
  component: TemplatesBrowser,
});

function TemplatesBrowser() {
  const [q, setQ] = useState("");
  const [dept, setDept] = useState<string>("");
  const filtered = TEMPLATES.filter((t) => {
    if (dept && t.meta.department !== dept) return false;
    if (q) {
      const s = q.toLowerCase();
      return (
        t.meta.document_code.toLowerCase().includes(s) ||
        t.meta.document_name.toLowerCase().includes(s)
      );
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Document templates</h1>
        <p className="text-sm text-muted-foreground">
          {TEMPLATES.length} ISO 13485:2016 controlled-document templates across {DEPARTMENTS.length} departments.
        </p>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search by code or name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
        <button
          onClick={() => setDept("")}
          className={`text-xs px-2 py-1 rounded border ${!dept ? "bg-primary text-primary-foreground" : ""}`}
        >
          All
        </button>
        {DEPARTMENTS.map((d) => (
          <button
            key={d.code}
            onClick={() => setDept(d.code)}
            className={`text-xs px-2 py-1 rounded border ${dept === d.code ? "bg-primary text-primary-foreground" : ""}`}
          >
            {d.code} · {d.name}
          </button>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((t) => (
          <Card key={t.meta.document_code}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between gap-2">
                <span className="font-mono">{t.meta.document_code}</span>
                <Badge variant="outline">{t.meta.department}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <p className="font-medium text-foreground">{t.meta.document_name}</p>
              <p className="text-muted-foreground">
                ISO clauses: {t.meta.iso_clauses.join(", ")}
              </p>
              <p className="text-muted-foreground">
                Retention: {t.meta.retention_period}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
