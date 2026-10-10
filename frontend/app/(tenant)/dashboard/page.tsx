'use client';
import dynamic from 'next/dynamic';
const Dashboard = dynamic(() => import('../../../src/features/tenant/dashboard/ui/dashboard'), { ssr: false });
export default function DashboardPage() { return <Dashboard />; }
