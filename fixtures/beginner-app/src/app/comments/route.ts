import { db } from '@/lib/db';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Number(url.searchParams.get('page') ?? '1');
  const rows = await db.comment.findMany();
  const total = rows.length;
  const start = (page - 1) * 10;
  const slice = rows.slice(start, start + 10);
  return Response.json({ total, slice });
}
