import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FirstPoint · 思考与表达',
    short_name: 'FirstPoint',
    description: '留一点空间，给自己的声音。',
    start_url: '/',
    display: 'standalone',
    background_color: '#FFF9F1',
    theme_color: '#FFF9F1',
    lang: 'zh-CN',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
    ],
  };
}
