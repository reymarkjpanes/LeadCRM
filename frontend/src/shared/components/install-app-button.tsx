'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { usePwaInstall } from '@/shared/providers/pwa-install-provider';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';

export function InstallAppButton() {
  const { status, dismissed, install, restorePromotion } = usePwaInstall();
  const [helpOpen, setHelpOpen] = useState(false);
  if (status === 'installed') return null;
  return <>
    <Button variant="outline" className="min-h-11 gap-2" disabled={status === 'prompting' || status === 'accepted'}
      onClick={() => { if (status === 'available') { restorePromotion(); void install(); } else setHelpOpen(true); }}>
      <Download size={16} aria-hidden="true" />Install app
    </Button>
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent aria-labelledby="install-help-title" aria-describedby="install-help-description">
        <DialogHeader><DialogTitle id="install-help-title">Install LeadCRM</DialogTitle>
          <DialogDescription id="install-help-description">Installation options depend on your browser and device.</DialogDescription></DialogHeader>
        <ul className="mt-4 space-y-3 text-sm leading-6">
          <li><strong>iPhone or iPad:</strong> open your browser’s Share menu, then choose Add to Home Screen. Safari supports this; other supported browsers also provide it.</li>
          <li><strong>Android:</strong> open the browser menu and look for Install app or Add to Home screen.</li>
          <li><strong>Chrome or Edge on desktop:</strong> look for the install icon in the address bar or Install app in the browser menu.</li>
          <li><strong>Safari on Mac:</strong> use File → Add to Dock where supported.</li>
        </ul>
        {dismissed && <Button variant="outline" className="mt-4" onClick={() => { restorePromotion(); setHelpOpen(false); }}>Show the install banner when available</Button>}
      </DialogContent>
    </Dialog>
  </>;
}
