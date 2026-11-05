import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { League_Spartan, Poppins } from 'next/font/google';
import '../src/index.css';
import { AppProviders } from '../src/shared/providers/app-providers';
import { APPEARANCE_INIT_SCRIPT } from '../src/lib/appearance-script';
import { ThemeProvider } from '../src/shared/providers/theme-provider';
import { ServiceWorkerRegistration } from '../src/shared/components/service-worker-registration';
import { PwaInstallProvider } from '../src/shared/providers/pwa-install-provider';

// Configure Google Fonts using Next.js font optimization
const leagueSpartan = League_Spartan({
  weight: ['400', '500', '600', '700', '800', '900'],
  subsets: ['latin'],
  variable: '--font-heading',
  display: 'swap',
});

const poppins = Poppins({
  weight: ['400', '500', '600', '700'],
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'LeadCRM - Camxian Technologies',
  description: 'The premier CRM platform for IT solutions providers, security firms, and telecom agencies.',
  icons: {
    icon: { url: '/favicon.ico?v=camxian-circle-1', type: 'image/x-icon', sizes: '16x16 32x32 48x48' },
    apple: { url: '/icons/camxian-180.png?v=camxian-circle-2', type: 'image/png', sizes: '180x180' },
  },
};

export const viewport: Viewport = {
  themeColor: '#07142A',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const initialHasSessionCookie = Boolean((await cookies()).get('leadcrm_token')?.value);
  return (
    <html lang="en" suppressHydrationWarning className={`${leagueSpartan.variable} ${poppins.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
        <link rel="manifest" href="/manifest.json" />
        {/* Neue Machina from Fontshare */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link href="https://api.fontshare.com/v2/css?f[]=neue-machina@200,300,400,500,700,800,900&display=swap" rel="stylesheet" />
        <style dangerouslySetInnerHTML={{
          __html: `
            .font-subtitle-test {
              font-family: 'Neue Machina', ui-sans-serif, system-ui, sans-serif !important;
              font-weight: 500;
            }
          `
        }} />
      </head>
      <body className={poppins.className} suppressHydrationWarning>
        <AppProviders initialHasSessionCookie={initialHasSessionCookie}>
          <ThemeProvider>
            <PwaInstallProvider>
              {children}
            </PwaInstallProvider>
          </ThemeProvider>
        </AppProviders>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
