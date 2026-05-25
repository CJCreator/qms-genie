# ISO 13485 QMS Document Automation Platform
## Department-Wise Important Structures & Cascading Generation Guide

**Core Principle**:  
Instead of generating only one template, the system must automatically generate the **complete set of all necessary documents** for the selected department(s) + all dependent documents from other departments, with full cross-reference updating and consistency validation.

### How Cascading Generation Works
1. User selects a department or triggers generation.
2. The engine loads all documents for that department.
3. It recursively loads every document listed in the `dependencies` field of each template.
4. It generates the entire dependency tree.
5. It runs the Consistency Validator across the whole set.
6. It updates all cross-references, ISO clause numbers, role names, document codes, and links.
7. All documents are saved in the persistent Document Repository with version history.

This ensures regulatory consistency and makes the app truly useful for small companies.

### Department-Wise Important Structures (Based on ISO 13485:2016 + 95 Documents)

#### 1. QMS & Top Management (Clauses 4, 5)
**Documents**: QP-001 to QF-002 (8 documents)  
**Key ISO 13485:2016 Clauses**: 4.1, 4.2, 5.1–5.6  
**Important Structures**:
- Quality Manual (QP-001)
- Quality Policy & Objectives (QP-002)
- Document Control Procedure (QP-003)
- Records Control Procedure (QP-004)
- Management Review Procedure (QP-005)
- Management Review Minutes (QF-001)
- Quality Objectives Tracking Sheet (QF-002)

#### 2. Research & Development (Clause 7.3)
**Documents**: RD-001 to RD-010 (10 documents)  
**Key ISO 13485:2016 Clauses**: 7.3 Design and development  
**Important Structures**:
- Design & Development Plan (RD-001)
- Design Input Requirements Specification (RD-002)
- Design Output Document / Drawings (RD-003)
- Design Review Records (RD-004)
- Design Verification Protocol & Report (RD-005)
- Design Validation Protocol & Report (RD-006)
- Risk Management File (RD-007)
- Design Transfer Checklist (RD-008)
- Design History File Index (RD-009)
- Software Requirements Specification (RD-010)

#### 3. Regulatory Affairs (Clauses 4.1, 7.2, 8.2.3)
**Documents**: RA-001 to RA-008 (8 documents)  
**Key ISO 13485:2016 Clauses**: 4.1, 7.2, 8.2.3  
**Important Structures**:
- Regulatory Strategy Document (RA-001)
- Technical File / Design Dossier (RA-002)
- Declaration of Conformity (RA-003)
- Post-Market Surveillance Plan (RA-005)
- Periodic Safety Update Report / PMCF Report (RA-006)

#### 4. Manufacturing (Clause 7.5)
**Documents**: MF-001 to MF-010 (10 documents)  
**Key ISO 13485:2016 Clauses**: 7.5 Production and service provision  
**Important Structures**:
- Manufacturing Procedure (MF-001)
- Device History Record (MF-002)
- Bill of Materials (MF-003)
- Process Validation Protocol & Report (MF-004)
- Traceability / Lot Control Record (MF-010)

#### 5. Software (IEC 62304 + Clause 7.3)
**Documents**: SW-001 to SW-012 (12 documents)  
**Key ISO 13485:2016 Clauses**: 7.3  
**Important Structures**:
- Software Development Plan (SW-001)
- Software Requirements Specification (SW-002)
- Software Architecture Document (SW-003)
- Software Validation Report (SW-008)
- Cybersecurity Risk Assessment (SW-009)

#### 6. HIMS
**Documents**: HI-001 to HI-012 (12 documents)  
**Key ISO 13485:2016 Clauses**: 7.3  
**Important Structures**:
- HIMS Validation Master Plan (HI-003)
- Installation Qualification (IQ) Protocol & Report (HI-004)
- Operational Qualification (OQ) Protocol & Report (HI-005)
- Performance Qualification (PQ) Protocol & Report (HI-006)

#### 7. Quality Control (Clauses 7.6, 8.2)
**Documents**: QC-001 to QC-008 (8 documents)  
**Key ISO 13485:2016 Clauses**: 7.6, 8.2  
**Important Structures**:
- Inspection & Test Plan (QC-001)
- Final Inspection & Release Record (QC-004)

#### 8. Supply Chain (Clause 7.4)
**Documents**: SC-001 to SC-007 (7 documents)  
**Key ISO 13485:2016 Clauses**: 7.4  
**Important Structures**:
- Approved Supplier List (SC-001)
- Supplier Qualification Procedure (SC-002)

#### 9. CAPA & Complaints (Clauses 8.3, 8.5)
**Documents**: CA-001 to CA-008 (8 documents)  
**Key ISO 13485:2016 Clauses**: 8.3, 8.5  
**Important Structures**:
- CAPA Procedure (CA-001)
- Complaint Handling Procedure (CA-003)
- Nonconformance Report (CA-007)

#### 10. Internal Audit (Clause 8.2.4)
**Documents**: AU-001 to AU-006 (6 documents)  
**Key ISO 13485:2016 Clauses**: 8.2.4  
**Important Structures**:
- Internal Audit Procedure (AU-001)
- Audit Report (AU-005)

#### 11. HR & Training (Clause 6.2)
**Documents**: HR-001 to HR-006 (6 documents)  
**Key ISO 13485:2016 Clauses**: 6.2  
**Important Structures**:
- Job Description (HR-001)
- Training Record (HR-004)
- Competency Assessment Record (HR-005)

