import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Jobcenter Wohnungs-Matcher Gelsenkirchen | immo.autoacts.link',
  description:
    'Finde passende Wohnungen nach den aktuellen KdU-Richtlinien der Stadt Gelsenkirchen (SGB II / Bürgergeld & SGB XII) – mit Privatvermieter-Filter & Direktabtretungs-Anschreiben.',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" className="dark">
      <body className="min-h-screen bg-slate-950 text-slate-100">{children}</body>
    </html>
  );
}
