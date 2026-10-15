import type { Metadata, Viewport } from 'next';
import { AppProvider } from '@/components/app-provider';
import { Shell } from '@/components/shell';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'FirstPoint · 让思绪慢慢清晰', template: '%s · FirstPoint' },
  description: '你的私人思考与表达教练。先说出来，找到重点，再用自己的话说一遍。',
  applicationName: 'FirstPoint',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'FirstPoint', statusBarStyle: 'default' },
  icons: { icon: '/icon.svg', apple: '/icon-180.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#FFF9F1' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AppProvider>
          <Shell>{children}</Shell>
        </AppProvider>
      </body>
    </html>
  );
}
