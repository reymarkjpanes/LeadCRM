export const WORKFLOW_NAME_CONFLICT = 'A workflow with this name already exists. Choose another name.';

/** Keep the whitespace set aligned with the workflow_name_key database function. */
export function cleanWorkflowName(name: string): string {
  return name.replace(/\s+/gu, ' ').trim();
}

export function workflowNameKey(name: string): string {
  return cleanWorkflowName(name).toLowerCase();
}

export function suggestWorkflowCopyName(name: string, reservedNames: Iterable<string>): string {
  const reserved = new Set(Array.from(reservedNames, workflowNameKey));
  const base = cleanWorkflowName(name).replace(/ \(Copy(?: \d+)?\)$/i, '');
  for (let index = 1; ; index++) {
    const suffix = index === 1 ? ' (Copy)' : ` (Copy ${index})`;
    const candidate = `${base.slice(0, 255 - suffix.length).trimEnd()}${suffix}`;
    if (!reserved.has(workflowNameKey(candidate))) return candidate;
  }
}
