// Loads all 95 ISO 13485 document templates as bundled JSON.
// Server-safe (used inside server functions / SSR and inside client UI for listings).

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
  | { id: string; title: string; type: "approval_block" }
  | {
      id: string;
      title: string;
      type: "clause_block";
      clauses: string[];
      section_prompt: string;
    }
  | {
      id: string;
      title: string;
      type: "table_spec";
      columns: { key: string; label: string; width?: number }[];
      rows?: Record<string, string>[]; // static rows
      ai_rows_prompt?: string; // if set, AI fills rows as JSON
      min_rows?: number;
    };

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
  dependencies?: string[];
}

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

// ---------------------------------------------------------------------------
// Cross-document dependency graph.
// Most JSON templates have an empty `dependencies` array — we layer regulatory
// dependencies on top so that generating any single document automatically
// pulls in the documents that govern, reference, or are referenced by it.
// ---------------------------------------------------------------------------

// Backbone: every controlled document inherits from the QMS spine.
const SPINE = ["QP-001", "QP-002", "QP-003", "QP-004"];

// Department-level common parents (department code -> codes every doc in that
// department depends on, in addition to the spine).
const DEPT_PARENTS: Record<string, string[]> = {
  AU: ["QP-005", "AU-001"],
  CA: ["CA-001", "CA-003"],
  HI: ["HI-001", "HI-003", "QP-006"],
  HR: ["HR-001", "HR-002"],
  MF: ["MF-001", "QC-001"],
  QC: ["QC-001"],
  QF: ["QP-005"],
  QP: [],
  RA: ["RA-001", "QP-006"],
  RD: ["RD-001", "RD-007"],
  SC: ["SC-002"],
  SW: ["SW-001", "RD-007"],
};

// Explicit cross-department links (per ISO 13485 traceability requirements).
const EXPLICIT: Record<string, string[]> = {
  // Audits feed CAPA and management review
  "AU-005": ["CA-001", "CA-002", "QF-001"],
  "AU-006": ["CA-001", "CA-002"],
  // CAPA links into nonconformance, complaints, vigilance
  "CA-002": ["CA-007", "CA-008"],
  "CA-005": ["RA-005", "RA-006"],
  "CA-006": ["RA-005", "RA-007"],
  // Design & Development chain
  "RD-002": ["RD-001"],
  "RD-003": ["RD-002"],
  "RD-005": ["RD-002", "RD-003"],
  "RD-006": ["RD-002", "RD-005"],
  "RD-008": ["RD-003", "MF-001", "MF-003"],
  "RD-009": ["RD-001", "RD-002", "RD-003", "RD-004", "RD-005", "RD-006", "RD-007", "RD-008"],
  // Software lifecycle (IEC 62304)
  "SW-002": ["SW-001", "RD-002"],
  "SW-003": ["SW-002"],
  "SW-007": ["SW-002", "SW-006"],
  "SW-008": ["SW-007", "RD-006"],
  "SW-009": ["SW-002", "RD-007"],
  // HIMS qualification chain
  "HI-004": ["HI-003"],
  "HI-005": ["HI-004"],
  "HI-006": ["HI-005"],
  // Manufacturing -> QC traceability
  "MF-002": ["MF-001", "MF-010", "QC-004"],
  "MF-004": ["MF-001"],
  "MF-010": ["MF-001", "MF-002"],
  // QC -> calibration
  "QC-005": ["QC-006"],
  "QC-007": ["QC-005"],
  // Supply chain
  "SC-003": ["SC-001", "SC-002"],
  "SC-005": ["SC-001"],
  "SC-006": ["CA-001"],
  // Regulatory affairs technical file
  "RA-002": ["RD-007", "RD-009", "RA-001", "RA-007"],
  "RA-003": ["RA-002"],
  "RA-005": ["CA-003", "CA-005"],
  "RA-006": ["RA-005"],
};

/** Resolve declared + implicit dependencies for a single document code. */
export function directDependencies(code: string): string[] {
  const tpl = TEMPLATES_BY_CODE[code];
  if (!tpl) return [];
  const dept = tpl.meta.department;
  const declared = tpl.dependencies ?? [];
  const deps = new Set<string>([
    ...declared,
    ...SPINE,
    ...(DEPT_PARENTS[dept] ?? []),
    ...(EXPLICIT[code] ?? []),
  ]);
  deps.delete(code); // a doc never depends on itself
  // only keep codes that exist in the registry
  return [...deps].filter((c) => TEMPLATES_BY_CODE[c]);
}

/** Transitive closure: a doc + everything it pulls in. */
export function expandWithDependencies(seedCodes: string[]): string[] {
  const out = new Set<string>();
  const stack = [...seedCodes];
  while (stack.length) {
    const c = stack.pop()!;
    if (out.has(c)) continue;
    if (!TEMPLATES_BY_CODE[c]) continue;
    out.add(c);
    for (const d of directDependencies(c)) {
      if (!out.has(d)) stack.push(d);
    }
  }
  return [...out].sort();
}

/** Expand a list of department codes to all docs (with dependency closure). */
export function expandDepartments(deptCodes: string[]): string[] {
  const seeds = TEMPLATES.filter((t) => deptCodes.includes(t.meta.department)).map(
    (t) => t.meta.document_code,
  );
  return expandWithDependencies(seeds);
}
