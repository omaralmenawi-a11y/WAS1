import { RequestClient } from './request';

export const dynamic = 'force-dynamic';

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RequestClient id={id} />;
}
