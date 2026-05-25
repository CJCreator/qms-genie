
ALTER TABLE public.generated_documents
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS released_by uuid,
  ADD COLUMN IF NOT EXISTS superseded_by_id uuid REFERENCES public.generated_documents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Allow members of the project's workspace to insert and update document rows.
CREATE POLICY "members insert docs"
ON public.generated_documents
FOR INSERT
TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = generated_documents.project_id
    AND public.has_workspace_access(p.workspace_id, auth.uid())
));

CREATE POLICY "members update docs"
ON public.generated_documents
FOR UPDATE
TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.projects p
  WHERE p.id = generated_documents.project_id
    AND public.has_workspace_access(p.workspace_id, auth.uid())
));

CREATE INDEX IF NOT EXISTS idx_generated_documents_project_code
  ON public.generated_documents(project_id, template_code, created_at DESC);
