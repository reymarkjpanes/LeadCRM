import { toast } from 'sonner';

/** Keep copy actions on the current page and report unavailable clipboard access. */
export async function copyTextWithFeedback(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  } catch {
    toast.error(`Unable to copy ${label.toLowerCase()}`);
  }
}
