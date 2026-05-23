// Loads all 95 ISO 13485 document templates as bundled JSON.
// Server-only (used inside server functions / SSR).

export type TemplateSection =
  | { id: string; title: string; type: "static"; content: string }
  | { id: string; title: string; type: "variable"; content: string }
  | {
      id: string;
      title: string;
      type: "ai_generated";
      section_prompt: string;
      editable?: boolean;
    }
  | { id: string; title: string; type: "table"; table_source: string }
  | { id: string; title: string; type: "approval_block" };

export interface TemplateInput {
  id: string;
  label: string;
  type: string;
  required?: boolean;
  source?: string;
}

export interface DocumentTemplate {
  meta: {
    document_code: string;
    document_name: string;
    department: string;
    iso_clauses: string[];
    default_prepared_by_role: string;
    default_approved_by_role: string;
    retention_period: string;
    applicable_device_types: string[];
    applicable_markets: string[];
  };
  inputs: TemplateInput[];
  sections: TemplateSection[];
  validation_rules?: {
    emits?: string[];
    consumes?: string[];
    required_sections_for_markets?: Record<string, string[]>;
  };
}

// Vite eager-glob: all 95 JSON files bundled at build time.
const modules = import.meta.glob("../templates/iso13485/*.json", {
  eager: true,
  import: "default",
}) as Record<string, DocumentTemplate>;

export const TEMPLATES: DocumentTemplate[] = Object.values(modules).sort((a, b) =>
  a.meta.document_code.localeCompare(b.meta.document_code),
);

export const TEMPLATES_BY_CODE: Record<string, DocumentTemplate> =
  Object.fromEntries(TEMPLATES.map((t) => [t.meta.document_code, t]));

export const DEPARTMENTS: { code: string; name: string }[] = (() => {
  const map: Record<string, string> = {
    AU: "Internal Audit",
    CA: "CAPA & Complaints",
    HI: "HIMS / Software Validation",
    HR: "Human Resources & Training",
    MF: "Manufacturing",
    QC: "Quality Control",
    QF: "Quality Forms",
    QP: "Quality Procedures",
    RA: "Regulatory Affairs",
    RD: "Research & Development",
    SC: "Supply Chain",
    SW: "Software / Cybersecurity",
  };
  const seen = new Set<string>();
  for (const t of TEMPLATES) seen.add(t.meta.department);
  return Array.from(seen)
    .sort()
    .map((code) => ({ code, name: map[code] ?? code }));
})();
