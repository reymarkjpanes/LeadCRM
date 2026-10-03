import React from 'react';
import { createRoot } from 'react-dom/client';
import { RolesPermissions } from '../../src/features/tenant/settings/ui/roles-permissions';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-slate-50"><RolesPermissions /></main>);
