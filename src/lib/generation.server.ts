// Server-only document generation engine.
// Renders ISO 13485 templates -> .docx, packages with master index .xlsx into a ZIP,
// uploads to Supabase Storage, returns the storage path.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  Header,
  Footer,
  PageNumber,
  ShadingType,
} from "docx";
import JSZip from "jszip";
import ExcelJS from "exceljs";
import pLimit from "p-limit";
import {
  TEMPLATES_BY_CODE,
  directDependencies,
  expandWithDependencies,
  type DocumentTemplate,
  type TemplateSection,
} from "./templates";
import { REGULATORY_SYSTEM_PROMPT } from "./regulatory-system-prompt";

export interface ValidationFinding {
  document_code: string | null;
  severity: "error" | "warning" | "info";
  message: string;
  field?: string | null;
}

export interface ProjectData {
  id: string;
  name: string;
  organisation_profile: Record<string, any>;
  device_portfolio: any[];
  department_scope: string[];
  department_inputs: Record<string, any>;
}

/**
 * Thrown by generateBundle when the pre-render validator finds blocking
 * (severity=error) issues. The server fn surfaces this to the UI so the user
 * can fix the wizard before another AI run is started.
 */
export class PreRenderValidationError extends Error {
  findings: ValidationFinding[];
  constructor(findings: ValidationFinding[]) {
    super(
      `Pre-render validation failed: ${findings.length} blocking issue(s). Fix the wizard inputs and try again.`,
    );
    this.name = "PreRenderValidationError";
    this.findings = findings;
  }
}

// ------- helpers ----------------------------------------------------------

function flattenVars(project: ProjectData): Record<string, string> {
  const org = project.organisation_profile || {};
  const dev = (project.device_portfolio && project.device_portfolio[0]) || {};
  return {
    company_legal_name: org.legal_name || org.name || "[Company Legal Name]",
    company_short_name: org.short_name || org.name || "[Company]",
    company_address: org.address || "[Address]",
    qa_manager_name: org.qa_manager_name || "[QA Manager Name]",
    qa_director_name: org.qa_director_name || "[QA Director Name]",
    management_representative: org.management_representative || "[Management Representative]",
    device_name_model: dev.name
      ? `${dev.name}${dev.model ? " " + dev.model : ""}`
      : "[Device Name & Model]",
    device_classification: dev.classification || "[Classification]",
    intended_use: dev.intended_use || "[Intended Use]",
    target_markets:
      (Array.isArray(org.markets) ? org.markets.join(", ") : org.markets) || "[Markets]",
    revision_number: "1.0",
    effective_date: new Date().toISOString().slice(0, 10),
    project_name: project.name,
  };
}

function substitute(text: string, vars: Record<string, string>): string {
  return text.replace(/\{([a-z0-9_]+)\}/gi, (_, k) => (k in vars ? vars[k] : `[${k}]`));
}

// ------- AI enrichment via Lovable AI Gateway -----------------------------

function chooseAIModel(sectionType: string, prompt: string) {
  const heavyTypes = new Set([
    "ai_generated",
    "clause_block",
    "table_spec",
    "risk_table",
    "traceability_matrix",
  ]);
  const longPrompt = prompt.length > 900;
  if (heavyTypes.has(sectionType) || longPrompt) {
    return "google/gemini-2.5-pro";
  }
  return "google/gemini-2.5-flash";
}

async function callAI(
  systemPrompt: string,
  userPrompt: string,
  sectionType: string,
  attempt = 0,
): Promise<string> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    return "[AI enrichment unavailable — LOVABLE_API_KEY not configured. Section requires manual authoring.]";
  }
  try {
    const model = chooseAIModel(sectionType, userPrompt);
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    // Retry on 429 / 5xx with exponential backoff (max 2 retries).
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const delay = 500 * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      return callAI(systemPrompt, userPrompt, sectionType, attempt + 1);
    }

    if (!res.ok) {
      const t = await res.text();
      return `[AI unavailable — manual authoring required. Gateway returned ${res.status}: ${t.slice(0, 160)}]`;
    }
    const j: any = await res.json();
    return j?.choices?.[0]?.message?.content?.trim() || "[AI returned empty content]";
  } catch (e: any) {
    if (attempt < 2) {
      const delay = 500 * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      return callAI(systemPrompt, userPrompt, sectionType, attempt + 1);
    }
    return `[AI unavailable — manual authoring required. ${e?.message || e}]`;
  }
}

// ------- per-document rendering -------------------------------------------

export async function renderSections(
  template: DocumentTemplate,
  project: ProjectData,
  vars: Record<string, string>,
  selectedCodes: Set<string>,
  sectionOverrides?: Record<string, Record<string, string>>,
): Promise<{ section: TemplateSection; text: string }[]> {
  // Build the dependency context the AI can cite (only docs actually in this run).
  const deps = directDependencies(template.meta.document_code).filter((c) => selectedCodes.has(c));
  const depList = deps.length
    ? deps.map((c) => `- ${c} ${TEMPLATES_BY_CODE[c]?.meta.document_name ?? ""}`).join("\n")
    : "(none for this section)";
  const deptInput = (project.department_inputs || {})[template.meta.department] || "";

  const orgContext = `Company: ${vars.company_legal_name}
Device: ${vars.device_name_model} (${vars.device_classification})
Target markets: ${vars.target_markets}
Document being authored: ${template.meta.document_code} — ${template.meta.document_name}
ISO 13485 clause(s): ${template.meta.iso_clauses.join(", ")}
Prepared by role: ${template.meta.default_prepared_by_role}
Approved by role: ${template.meta.default_approved_by_role}
Department additional context: ${deptInput || "(none)"}
Cross-referenceable documents in this run (use {ref:CODE} placeholders to link):
${depList}`;

  const out: { section: TemplateSection; text: string; payload?: any }[] = [];
  for (const sec of template.sections) {
    // If an override for this exact document->section exists, use it and
    // skip any AI enrichment for that section.
    const docOverrides = sectionOverrides?.[template.meta.document_code] ?? {};
    const overrideText = docOverrides?.[sec.id];
    if (overrideText) {
      out.push({ section: sec, text: substitute(overrideText, vars) });
      continue;
    }

    if (sec.type === "static" || sec.type === "variable") {
      out.push({ section: sec, text: substitute(sec.content, vars) });
    } else if (sec.type === "ai_generated") {
      const userPrompt = `${orgContext}

Section to author: ${sec.title}
Instruction: ${sec.section_prompt}`;
      const text = await callAI(REGULATORY_SYSTEM_PROMPT, userPrompt, sec.type);
      out.push({ section: sec, text });
    } else if (sec.type === "clause_block") {
      const userPrompt = `${orgContext}

You are authoring section "${sec.title}" which covers ISO 13485 clause(s) ${sec.clauses.join(", ")}.
For EACH clause listed, produce a short numbered subsection (e.g. "4.1.1 …") with concrete, procedural language tailored to the company and device above. Do NOT restate the clause text generically — write what THIS company does to meet it. Cite related QMS documents using {ref:CODE} placeholders where appropriate.

Instruction: ${sec.section_prompt}`;
      const text = await callAI(REGULATORY_SYSTEM_PROMPT, userPrompt, sec.type);
      out.push({ section: sec, text });
    } else if (sec.type === "table_spec") {
      let rows: Record<string, string>[] = sec.rows
        ? sec.rows.map((r) => {
            const o: Record<string, string> = {};
            for (const k of Object.keys(r)) o[k] = substitute(r[k], vars);
            return o;
          })
        : [];
      if (sec.ai_rows_prompt) {
        const colSpec = sec.columns.map((c) => `"${c.key}" (${c.label})`).join(", ");
        const userPrompt = `${orgContext}

You are filling rows for the table "${sec.title}".
Columns: ${colSpec}.
Return ONLY a JSON array (no prose, no markdown fences) of at least ${sec.min_rows ?? 3} objects. Each object MUST use exactly these keys: ${sec.columns.map((c) => `"${c.key}"`).join(", ")}.
Be specific to the company and device above — no placeholders like "TBD".

Instruction: ${sec.ai_rows_prompt}`;
        const raw = await callAI(REGULATORY_SYSTEM_PROMPT, userPrompt, sec.type);
        const aiRows = parseJsonArray(raw);
        if (aiRows.length) rows = [...rows, ...aiRows];
      }
      out.push({
        section: sec,
        text: rows
          .map((r) => sec.columns.map((c) => `${c.label}: ${r[c.key] ?? ""}`).join(" | "))
          .join("\n"),
        payload: { rows },
      });
    } else if (sec.type === "approval_block") {
      out.push({
        section: sec,
        text: `Prepared by: ${template.meta.default_prepared_by_role} — ${vars.qa_manager_name}\nApproved by: ${template.meta.default_approved_by_role} — ${vars.qa_director_name}\nEffective Date: ${vars.effective_date}`,
      });
    } else if (sec.type === "risk_table" || sec.type === "traceability_matrix") {
      let rows: Record<string, string>[] = sec.rows
        ? sec.rows.map((r) => {
            const o: Record<string, string> = {};
            for (const k of Object.keys(r)) o[k] = substitute(r[k], vars);
            return o;
          })
        : [];
      if (sec.ai_rows_prompt) {
        const colSpec = sec.columns.map((c) => `"${c.key}" (${c.label})`).join(", ");
        const userPrompt = `${orgContext}

You are filling rows for the ${sec.type.replace("_", " ")} "${sec.title}".
Columns: ${colSpec}.
Return ONLY a JSON array (no prose, no markdown fences) of at least ${sec.min_rows ?? 3} objects. Each object MUST use exactly these keys: ${sec.columns.map((c) => `"${c.key}"`).join(", ")}.
Be specific to the company and device above — no placeholders like "TBD".

Instruction: ${sec.ai_rows_prompt}`;
        const raw = await callAI(REGULATORY_SYSTEM_PROMPT, userPrompt, sec.type);
        const aiRows = parseJsonArray(raw);
        if (aiRows.length) rows = [...rows, ...aiRows];
      }
      out.push({
        section: sec,
        text: rows
          .map((r) => sec.columns.map((c) => `${c.label}: ${r[c.key] ?? ""}`).join(" | "))
          .join("\n"),
        payload: { rows },
      });
    } else if (sec.type === "table") {
      // Render controlled-record tables (revision history, distribution, etc.)
      // as actual DOCX tables with seeded initial rows. Reviewers fill in
      // subsequent rows on each controlled change.
      if (sec.table_source === "revision_history") {
        out.push({
          section: sec,
          text: `Rev ${vars.revision_number} | ${vars.effective_date} | ${vars.qa_manager_name} | Initial issue of ${template.meta.document_code}`,
          payload: {
            rows: [
              {
                rev: vars.revision_number,
                date: vars.effective_date,
                author: vars.qa_manager_name,
                description: `Initial issue of ${template.meta.document_code} — ${template.meta.document_name}.`,
              },
            ],
            columns: [
              { key: "rev", label: "Rev" },
              { key: "date", label: "Effective Date" },
              { key: "author", label: "Author" },
              { key: "description", label: "Change Description" },
            ],
          },
        });
      } else {
        out.push({
          section: sec,
          text: `[${sec.table_source} table — maintained as controlled record]`,
        });
      }
    }
  }
  return out;
}

function parseJsonArray(raw: string): Record<string, string>[] {
  if (!raw) return [];
  // Strip markdown fences if model added them
  const cleaned = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  // Find the first [ and last ]
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) return [];
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => r && typeof r === "object")
      .map((r) => {
        const o: Record<string, string> = {};
        for (const k of Object.keys(r)) o[k] = String(r[k] ?? "");
        return o;
      });
  } catch {
    return [];
  }
}

// ------- cross-reference rewriter -----------------------------------------

/**
 * Resolve {ref:CODE} and {ref:CODE#section} placeholders against the registry
 * built from this run. Unknown codes are left as a visible "[ref?:CODE]"
 * marker rather than silently dropped, so reviewers can spot them.
 */
type CrossRefRegistryEntry = {
  name: string;
  sections: { id: string; title: string }[];
};

function resolveRolePlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\{role:([a-z0-9_]+)\}/gi, (_m, role) => {
    const substituteKey = role.toLowerCase();
    const value = Object.entries(vars).find(([key]) => key.toLowerCase() === substituteKey)?.[1];
    return value ?? `[role?:${role}]`;
  });
}

function rewriteCrossRefs(
  text: string,
  registry: Record<string, CrossRefRegistryEntry>,
  vars: Record<string, string>,
): string {
  let result = text.replace(/\{ref:([A-Z]{2}-\d{3})(?:#([a-zA-Z0-9_-]+))?\}/g, (_m, code, sec) => {
    const r = registry[code];
    if (!r) return `[ref?:${code}]`;
    if (!sec) return `${code} ${r.name}`;
    const section = r.sections.find((s) => s.id === sec);
    return section ? `${code} ${r.name} — ${section.title}` : `${code} ${r.name} §${sec}`;
  });

  result = resolveRolePlaceholders(result, vars);
  return result;
}

function buildDocx(
  template: DocumentTemplate,
  rendered: { section: TemplateSection; text: string; payload?: any }[],
  vars: Record<string, string>,
): Promise<Buffer> {
  const children: any[] = [];
  const cfg: any = (template as any).output_config || {};

  // Title
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 120 },
      children: [new TextRun({ text: template.meta.document_name, bold: true, size: 32 })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [
        new TextRun({
          text: `Document Code: ${template.meta.document_code}  |  ISO 13485:2016 clause(s) ${template.meta.iso_clauses.join(", ")}`,
          italics: true,
          size: 20,
          color: "555555",
        }),
      ],
    }),
  );

  const cellBorder = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
  const cellBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };

  for (const { section, text, payload } of rendered) {
    if (section.title) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 80 },
          children: [new TextRun({ text: section.title, bold: true, size: 26 })],
        }),
      );
    }
    if (section.type === "approval_block") {
      const rows = text.split("\n").map(
        (line) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 9360, type: WidthType.DXA },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                borders: cellBorders,
                children: [new Paragraph({ children: [new TextRun(line)] })],
              }),
            ],
          }),
      );
      children.push(
        new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [9360],
          rows,
        }),
      );
    } else if (
      section.type === "table_spec" ||
      section.type === "risk_table" ||
      section.type === "traceability_matrix" ||
      (section.type === "table" && payload?.columns && payload?.rows)
    ) {
      const cols = ((section as any).columns ?? payload?.columns) as {
        key: string;
        label: string;
        width?: number;
      }[];
      const totalW = 9360;
      const baseW = Math.floor(totalW / cols.length);
      const colWidths = cols.map((_, i) =>
        i === cols.length - 1 ? totalW - baseW * (cols.length - 1) : baseW,
      );
      const headerRow = new TableRow({
        tableHeader: true,
        children: cols.map(
          (c, i) =>
            new TableCell({
              width: { size: colWidths[i], type: WidthType.DXA },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: cellBorders,
              shading: { fill: "EEF2F7", type: ShadingType.CLEAR, color: "auto" },
              children: [
                new Paragraph({ children: [new TextRun({ text: c.label, bold: true, size: 20 })] }),
              ],
            }),
        ),
      });
      const dataRows: TableRow[] = ((payload?.rows ?? []) as Record<string, string>[]).map(
        (r) =>
          new TableRow({
            children: cols.map(
              (c, i) =>
                new TableCell({
                  width: { size: colWidths[i], type: WidthType.DXA },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  borders: cellBorders,
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: String(r[c.key] ?? ""), size: 20 })],
                    }),
                  ],
                }),
            ),
          }),
      );
      if (!dataRows.length) {
        dataRows.push(
          new TableRow({
            children: cols.map(
              (_, i) =>
                new TableCell({
                  width: { size: colWidths[i], type: WidthType.DXA },
                  margins: { top: 80, bottom: 80, left: 120, right: 120 },
                  borders: cellBorders,
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({ text: "—", italics: true, size: 20, color: "888888" }),
                      ],
                    }),
                  ],
                }),
            ),
          }),
        );
      }
      children.push(
        new Table({
          width: { size: totalW, type: WidthType.DXA },
          columnWidths: colWidths,
          rows: [headerRow, ...dataRows],
        }),
      );
    } else {
      for (const line of text.split("\n")) {
        children.push(
          new Paragraph({
            spacing: { after: 80 },
            children: [new TextRun({ text: line, size: 22 })],
          }),
        );
      }
    }
  }

  // Page size from output_config (A4 default).
  const pageSize =
    cfg.page_size === "Letter" ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 }; // A4 default

  // Header / footer strings with variable substitution.
  const headerText = cfg.header
    ? substitute(String(cfg.header), vars)
    : `${vars.company_legal_name} | ${template.meta.document_code} | Rev ${vars.revision_number}`;
  const footerText = cfg.footer
    ? substitute(String(cfg.footer), vars)
    : `CONFIDENTIAL — Controlled Document | ISO 13485:2016`;

  const doc = new Document({
    creator: "ISO 13485 QMS Platform",
    title: `${template.meta.document_code} — ${template.meta.document_name}`,
    sections: [
      {
        properties: {
          page: {
            size: pageSize,
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [new TextRun({ text: headerText, size: 18, color: "666666" })],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({ text: footerText + "  ·  Page ", size: 16, color: "888888" }),
                  new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "888888" }),
                  new TextRun({ text: " / ", size: 16, color: "888888" }),
                  new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: "888888" }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(doc) as unknown as Promise<Buffer>;
}

// ------- traceability + validator ------------------------------------------

function buildTraceability(codes: string[]) {
  return codes.map((c) => {
    const t = TEMPLATES_BY_CODE[c];
    return {
      code: c,
      name: t?.meta.document_name ?? "",
      department: t?.meta.department ?? "",
      clauses: t?.meta.iso_clauses.join(", ") ?? "",
      dependencies: directDependencies(c).join(", "),
    };
  });
}

/**
 * Pre-render Consistency Validator. Runs BEFORE any AI calls so we don't burn
 * tokens on a project that will produce placeholder garbage. Returns a list of
 * findings — callers should check `severity === "error"` to decide whether to
 * block the run.
 */
export function validateBeforeRender(project: ProjectData, codes: string[]): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const org = project.organisation_profile || {};

  // Org profile: blocking
  const requiredOrgErrors: [string, string][] = [
    ["legal_name", "Organisation legal name"],
    ["qa_manager_name", "QA Manager name"],
    ["qa_director_name", "QA Director name"],
  ];
  for (const [k, label] of requiredOrgErrors) {
    if (!org[k] || !String(org[k]).trim()) {
      findings.push({
        document_code: null,
        severity: "error",
        field: `organisation_profile.${k}`,
        message: `${label} is required. Fill this in the Organisation Profile wizard step.`,
      });
    }
  }

  // Org profile: soft
  const requiredOrgWarnings: [string, string][] = [
    ["address", "Registered address"],
    ["management_representative", "Management representative"],
  ];
  for (const [k, label] of requiredOrgWarnings) {
    if (!org[k] || !String(org[k]).trim()) {
      findings.push({
        document_code: null,
        severity: "warning",
        field: `organisation_profile.${k}`,
        message: `${label} is missing — will render as a placeholder.`,
      });
    }
  }

  const markets: string[] = Array.isArray(org.markets)
    ? org.markets
    : typeof org.markets === "string"
      ? org.markets
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean)
      : [];
  if (!markets.length) {
    findings.push({
      document_code: null,
      severity: "error",
      field: "organisation_profile.markets",
      message: "At least one target market (EU, US, UK, …) must be selected before generating.",
    });
  }

  const regulatedMarkets = markets.map((m) => m.toLowerCase());

  const dev = project.device_portfolio?.[0];
  if (!project.device_portfolio?.length || !dev?.name) {
    findings.push({
      document_code: null,
      severity: "error",
      field: "device_portfolio",
      message:
        "At least one device with a name is required. Add it in the Device Portfolio wizard step.",
    });
  } else {
    if (!dev.classification) {
      findings.push({
        document_code: null,
        severity: regulatedMarkets.some((m) => ["eu", "us", "uk"].includes(m))
          ? "error"
          : "warning",
        field: "device_portfolio[0].classification",
        message:
          "Device classification (Class I/IIa/IIb/III) is required for regulated markets and should be provided.",
      });
    }
    if (!dev.intended_use) {
      findings.push({
        document_code: null,
        severity: "warning",
        field: "device_portfolio[0].intended_use",
        message: "Device intended use is missing — required for RA-002 / RD-002.",
      });
    }
  }

  // Dependency closure: blocking
  const set = new Set(codes);
  for (const c of codes) {
    const tpl = TEMPLATES_BY_CODE[c];
    if (!tpl) continue;
    for (const dep of directDependencies(c)) {
      if (!set.has(dep)) {
        findings.push({
          document_code: c,
          severity: "error",
          field: "dependencies",
          message: `Depends on ${dep} which was not included in this run.`,
        });
      }
    }
  }

  // Market vs required_sections_for_markets: warning
  for (const c of codes) {
    const tpl = TEMPLATES_BY_CODE[c];
    if (!tpl) continue;
    const required = tpl.validation_rules?.required_sections_for_markets ?? {};
    for (const m of markets) {
      const need = required[m];
      if (!need?.length) continue;
      const have = new Set(tpl.sections.map((s) => s.id));
      const missing = need.filter((id) => !have.has(id));
      if (missing.length) {
        findings.push({
          document_code: c,
          severity: "warning",
          field: `required_sections_for_markets.${m}`,
          message: `Market ${m} expects sections [${missing.join(", ")}] which are not defined in this template.`,
        });
      }
    }
  }

  // Role fields: recommended for approvals and audit review sections.
  const roleFields: [string, string][] = [
    ["qa_manager_name", "QA Manager name"],
    ["qa_director_name", "QA Director name"],
    ["management_representative", "Management representative"],
  ];
  for (const [k, label] of roleFields) {
    if (!org[k] || !String(org[k]).trim()) {
      findings.push({
        document_code: null,
        severity: "warning",
        field: `organisation_profile.${k}`,
        message: `${label} is recommended for approval, review and role-based sections.`,
      });
    }
  }

  // Detect role placeholders in templates and warn if corresponding organisation role values
  // are not present. This helps catch missing replacement data before AI generation.
  const placeholderPattern = /\{role:([a-z0-9_]+)\}/gi;
  const placeholderKeys = new Set<string>();
  for (const c of codes) {
    const tpl = TEMPLATES_BY_CODE[c];
    if (!tpl) continue;
    for (const section of tpl.sections) {
      const fieldSource =
        section.type === "static" || section.type === "variable"
          ? section.content
          : section.type === "ai_generated" || section.type === "clause_block"
            ? section.section_prompt
            : section.type === "table_spec" ||
                section.type === "risk_table" ||
                section.type === "traceability_matrix"
              ? `${section.ai_rows_prompt ?? ""}`
              : "";
      let match: RegExpExecArray | null;
      while ((match = placeholderPattern.exec(fieldSource))) {
        placeholderKeys.add(match[1]);
      }
    }
  }
  for (const key of placeholderKeys) {
    const resolved = Object.keys(org).some((orgKey) => orgKey.toLowerCase() === key.toLowerCase());
    if (!resolved) {
      findings.push({
        document_code: null,
        severity: "warning",
        field: `organisation_profile.${key}`,
        message: `Role placeholder {role:${key}} appears in templates but no matching organisation field was provided.`,
      });
    }
  }

  return findings;
}

function buildTraceXlsxAppend(
  wb: ExcelJS.Workbook,
  codes: string[],
  findings: ValidationFinding[],
) {
  const trace = wb.addWorksheet("Traceability");
  trace.columns = [
    { header: "Code", key: "code", width: 12 },
    { header: "Document", key: "name", width: 50 },
    { header: "Dept", key: "department", width: 8 },
    { header: "ISO Clauses", key: "clauses", width: 22 },
    { header: "Dependencies", key: "dependencies", width: 60 },
  ];
  trace.getRow(1).font = { bold: true };
  for (const row of buildTraceability(codes)) trace.addRow(row);

  const find = wb.addWorksheet("Validation");
  find.columns = [
    { header: "Severity", key: "severity", width: 10 },
    { header: "Document", key: "document_code", width: 12 },
    { header: "Field", key: "field", width: 28 },
    { header: "Message", key: "message", width: 80 },
  ];
  find.getRow(1).font = { bold: true };
  for (const f of findings) find.addRow(f);
}

// ------- cross-document consistency checks --------------------------------

/**
 * Rules enforced across the entire generated package:
 *
 *  - Audit findings (AU-005 Audit Report, AU-006 Audit Finding & CAPA Linkage
 *    Log) MUST trace to CAPA (CA-001 or CA-002) — an audit major/minor without
 *    a CAPA linkage is an ISO 13485 §8.2.2 / §8.5.2 gap.
 *  - Supplier actions (SC-005 Supplier Performance Monitoring, SC-006 SCAR)
 *    MUST trace to CAPA (CA-001) — supplier escalations are CAPA inputs per
 *    §7.4.1.
 *  - CAPA records (CA-001, CA-002) SHOULD trace to the Risk Management File
 *    (RD-007) so risk acceptability is re-evaluated when the CAPA changes
 *    controls (ISO 14971 §10).
 *  - Every {ref:CODE} placeholder in any document MUST resolve to a document
 *    actually present in the master index (handled in generateBundle).
 *  - Any unresolved [ref?:CODE] surviving the rewriter is a hard error.
 */
export function validateCrossDocumentConsistency(
  docs: { code: string; sections: { section: TemplateSection; text: string; payload?: any }[] }[],
  refsByDoc: Record<string, Set<string>>,
  selectedSet: Set<string>,
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const present = (code: string) => selectedSet.has(code);
  const refs = (code: string) => refsByDoc[code] ?? new Set<string>();

  // Rule 1 — audit -> CAPA linkage
  for (const auditCode of ["AU-005", "AU-006"]) {
    if (!present(auditCode)) continue;
    const r = refs(auditCode);
    if (!r.has("CA-001") && !r.has("CA-002")) {
      findings.push({
        document_code: auditCode,
        severity: "error",
        field: "capa_linkage",
        message: `${auditCode} does not reference CA-001 (CAPA Procedure) or CA-002 (CAPA Form). Audit findings must be traceable to CAPA per ISO 13485 §8.2.2 / §8.5.2.`,
      });
    }
  }

  // Rule 2 — supplier actions -> CAPA linkage
  for (const supCode of ["SC-005", "SC-006"]) {
    if (!present(supCode)) continue;
    const r = refs(supCode);
    if (!r.has("CA-001")) {
      findings.push({
        document_code: supCode,
        severity: "error",
        field: "capa_linkage",
        message: `${supCode} does not reference CA-001 (CAPA Procedure). Supplier nonconformities and SCARs must escalate into CAPA per ISO 13485 §7.4.1 / §8.5.2.`,
      });
    }
  }

  // Rule 3 — CAPA -> Risk Management File linkage (warning)
  for (const capaCode of ["CA-001", "CA-002"]) {
    if (!present(capaCode)) continue;
    if (!present("RD-007")) continue; // can't link to what isn't in the run
    if (!refs(capaCode).has("RD-007")) {
      findings.push({
        document_code: capaCode,
        severity: "warning",
        field: "risk_linkage",
        message: `${capaCode} should reference RD-007 (Risk Management File) so risk acceptability is re-evaluated when CAPA changes controls (ISO 14971 §10).`,
      });
    }
  }

  // Rule 4 — unresolved [ref?:CODE] markers surviving the rewriter
  const unresolvedRe = /\[ref\?:([A-Z]{2}-\d{3})\]/g;
  for (const r of docs) {
    const hits = new Set<string>();
    const scan = (t: string) => {
      let m: RegExpExecArray | null;
      unresolvedRe.lastIndex = 0;
      while ((m = unresolvedRe.exec(t))) hits.add(m[1]);
    };
    for (const s of r.sections) {
      scan(s.text);
      const rows = (s.payload?.rows ?? []) as Record<string, string>[];
      for (const row of rows) for (const v of Object.values(row)) scan(String(v ?? ""));
    }
    for (const code of hits) {
      findings.push({
        document_code: r.code,
        severity: "error",
        field: "cross_reference",
        message: `${r.code} contains an unresolved cross-reference to ${code}. Either add ${code} to this run or remove the reference.`,
      });
    }
  }

  return findings;
}

// ------- main entry -------------------------------------------------------

export async function generateBundle(
  project: ProjectData,
  selectedCodes: string[],
  onProgress?: (done: number, total: number, code: string) => void | Promise<void>,
  sectionOverrides?: Record<string, Record<string, string>>,
): Promise<{
  zip: Buffer;
  entries: { code: string; name: string; filename: string; buffer: Buffer }[];
  findings: ValidationFinding[];
}> {
  // ---- Pass 0: pre-render Consistency Validator (BLOCKS on errors) -------
  const preFindings = validateBeforeRender(project, selectedCodes);
  const blocking = preFindings.filter((f) => f.severity === "error");
  if (blocking.length) throw new PreRenderValidationError(preFindings);

  const vars = flattenVars(project);
  const selectedSet = new Set(selectedCodes);
  const zip = new JSZip();
  const limit = pLimit(3);

  // ---- Pass 1: render every selected document's sections to plain text ---
  type RenderedDoc = {
    code: string;
    template: DocumentTemplate;
    sections: { section: TemplateSection; text: string; payload?: any }[];
  };
  const renderedDocs: RenderedDoc[] = [];
  let done = 0;
  const total = selectedCodes.length;

  const renderTasks = selectedCodes.map((code) =>
    limit(async () => {
      const tpl = TEMPLATES_BY_CODE[code];
      if (!tpl) return;
      const sections = await renderSections(tpl, project, vars, selectedSet, sectionOverrides);
      renderedDocs.push({ code, template: tpl, sections });
      done += 1;
      try {
        await onProgress?.(done, total, code);
      } catch {}
    }),
  );
  await Promise.all(renderTasks);

  // ---- Pass 2: cross-reference rewriter ----------------------------------
  const registry: Record<string, CrossRefRegistryEntry> = {};
  for (const r of renderedDocs) {
    registry[r.code] = {
      name: r.template.meta.document_name,
      sections: r.template.sections.map((section) => ({
        id: section.id,
        title: section.title,
      })),
    };
  }

  // Capture every {ref:CODE} reference each rendered doc makes BEFORE rewrite,
  // so we can run cross-document consistency rules in Pass 2.5.
  const refsByDoc: Record<string, Set<string>> = {};
  for (const r of renderedDocs) {
    const refs = new Set<string>();
    const scan = (text: string) => {
      const re = /\{ref:([A-Z]{2}-\d{3})(?:#[a-zA-Z0-9_-]+)?\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) refs.add(m[1]);
    };
    for (const s of r.sections) {
      scan(s.text);
      const rows = (s.payload?.rows ?? []) as Record<string, string>[];
      for (const row of rows) for (const v of Object.values(row)) scan(String(v ?? ""));
    }
    refsByDoc[r.code] = refs;
  }

  for (const r of renderedDocs) {
    r.sections = r.sections.map((s) => ({
      section: s.section,
      text: rewriteCrossRefs(s.text, registry, vars),
      payload: s.payload
        ? {
            ...s.payload,
            rows: ((s.payload.rows ?? []) as Record<string, string>[]).map((row) => {
              const o: Record<string, string> = {};
              for (const k of Object.keys(row))
                o[k] = rewriteCrossRefs(String(row[k] ?? ""), registry, vars);
              return o;
            }),
          }
        : s.payload,
    }));
  }

  // ---- Pass 2.5: cross-document consistency checks -----------------------
  const crossFindings = validateCrossDocumentConsistency(
    renderedDocs.map((r) => ({ code: r.code, sections: r.sections })),
    refsByDoc,
    selectedSet,
  );

  // ---- Build .docx per document ------------------------------------------
  const entries: {
    code: string;
    name: string;
    department: string;
    clauses: string;
    filename: string;
    buffer: Buffer;
  }[] = [];
  for (const r of renderedDocs) {
    const buf = await buildDocx(r.template, r.sections, vars);
    const safeName = `${r.template.meta.document_code}_${r.template.meta.document_name.replace(/[^\w-]+/g, "_")}.docx`;
    const folder = r.template.meta.department;
    zip.folder(folder)!.file(safeName, buf);
    entries.push({
      code: r.template.meta.document_code,
      name: r.template.meta.document_name,
      department: r.template.meta.department,
      clauses: r.template.meta.iso_clauses.join(", "),
      filename: `${folder}/${safeName}`,
      buffer: buf,
    });
  }
  entries.sort((a, b) => a.code.localeCompare(b.code));

  // Master-index coverage check: every code referenced by any doc must appear
  // in the final entries list (i.e. the rendered+packaged master index).
  const indexCodes = new Set(entries.map((e) => e.code));
  for (const [doc, refs] of Object.entries(refsByDoc)) {
    for (const ref of refs) {
      if (!indexCodes.has(ref)) {
        crossFindings.push({
          document_code: doc,
          severity: "error",
          field: "master_index",
          message: `${doc} references ${ref} but ${ref} is not present in the master document index (00_Master_Index.xlsx).`,
        });
      }
    }
  }

  // Carry through non-blocking pre-render findings (warnings/info) into the run,
  // plus the cross-document consistency findings.
  const findings = [...preFindings.filter((f) => f.severity !== "error"), ...crossFindings];

  // master index workbook (index + traceability + validation)
  const wb = new ExcelJS.Workbook();
  wb.creator = "ISO 13485 QMS Platform";
  const ws = wb.addWorksheet("Master Index");
  ws.columns = [
    { header: "Code", key: "code", width: 12 },
    { header: "Document Name", key: "name", width: 52 },
    { header: "Department", key: "department", width: 16 },
    { header: "ISO 13485 Clause(s)", key: "clauses", width: 24 },
    { header: "Filename", key: "filename", width: 60 },
  ];
  ws.getRow(1).font = { bold: true };
  entries.forEach((e) => ws.addRow(e));

  const meta = wb.addWorksheet("Project");
  meta.addRows([
    ["Project", project.name],
    ["Generated", new Date().toISOString()],
    ["Company", project.organisation_profile?.legal_name || ""],
    ["Devices", (project.device_portfolio || []).map((d: any) => d.name).join("; ")],
    ["Departments", (project.department_scope || []).join(", ")],
    ["Total documents", entries.length],
    ["Validation findings", findings.length],
  ]);
  meta.getColumn(1).font = { bold: true };
  meta.getColumn(1).width = 22;
  meta.getColumn(2).width = 80;

  buildTraceXlsxAppend(
    wb,
    entries.map((e) => e.code),
    findings,
  );
  const indexBuf = Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
  zip.file("00_Master_Index.xlsx", indexBuf);

  zip.file(
    "README.txt",
    `ISO 13485:2016 QMS Document Package
Project: ${project.name}
Generated: ${new Date().toISOString()}
Documents: ${entries.length}
Validation findings: ${findings.length}

Dependency-aware generation: every document in this package was rendered together
with its declared cross-references so that traceability across the QMS is preserved.
Cross-document links (e.g. "QP-003 Document Control Procedure") were resolved by
the cross-reference rewriter after all sections were drafted.
Review the Master Index, Traceability, and Validation tabs of 00_Master_Index.xlsx
before release. Apply approvals and signatures per your controlled-document procedure.`,
  );

  const zipBuf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { zip: zipBuf, entries, findings };
}

/**
 * Render a single document's sections (AI-enriched) for preview/edit flows.
 * Returns section id/title/type and the drafted text for client-side review.
 */
export async function renderDocumentPreview(
  project: ProjectData,
  code: string,
  sectionOverrides?: Record<string, Record<string, string>>,
): Promise<{ id: string; title: string; type: string; text: string }[]> {
  const tpl = TEMPLATES_BY_CODE[code];
  if (!tpl) return [];
  const vars = flattenVars(project);
  const selectedCodes = expandWithDependencies([code]);
  const selectedSet = new Set(selectedCodes);
  const rendered = await renderSections(tpl, project, vars, selectedSet, sectionOverrides);
  return rendered.map((r) => ({ id: r.section.id, title: r.section.title, type: r.section.type, text: r.text }));
}
