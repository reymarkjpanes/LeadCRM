'use client';

import Dashboard from '@/features/tenant/dashboard/ui/dashboard';
import { dashboardQueryString } from '@/features/tenant/dashboard/hooks/use-dashboard-report';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import type { DashboardQuery, DashboardReport } from '@leadcrm/shared';

function ReportsCsvExport({ query, report, error, className }: { query: DashboardQuery; report: DashboardReport | null; error: string | null; className: string }) {
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const response = await fetch(`/api/proxy/reporting/dashboard/export?${dashboardQueryString(query)}`, { credentials: 'include', cache: 'no-store' });
      if (!response.ok) throw new Error('Export could not load. Your access or reporting data may have changed.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url;
      link.download = `LeadCRM_Dashboard_${report?.period.start}_${report?.period.end}.csv`;
      document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      toast.success('Dashboard exported to CSV');
    } catch (err) { toast.error(err instanceof Error ? err.message : 'Export failed'); }
    finally { setExporting(false); }
  };
  return <button onClick={exportCsv} disabled={!report || exporting || !!error} className={className} title="Export CSV" aria-label={exporting ? 'Exporting…' : 'Export CSV'}><Download size={14} aria-hidden="true" /><span className="hidden sm:inline">{exporting ? 'Exporting…' : 'Export CSV'}</span></button>;
}

/** Reports reuse the authorized Dashboard view and retain their CSV control. */
export default function ReportsPage() {
  return <Dashboard heading="Analytics & Reports" renderToolbarActions={props => <ReportsCsvExport {...props} />} />;
}
