import type { Metadata } from 'next';
import { BoardClient } from './board-client';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'شاشة الانصراف',
  robots: { index: false, follow: false, nocache: true },
};

export default async function BoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <BoardClient token={token} />;
}
