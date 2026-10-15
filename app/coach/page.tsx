import { Suspense } from 'react';
import { CoachPage } from '@/components/coach-page';
export default function Page() {
  return (
    <Suspense fallback={<div className="loading-page">正在翻开练习页…</div>}>
      <CoachPage />
    </Suspense>
  );
}
