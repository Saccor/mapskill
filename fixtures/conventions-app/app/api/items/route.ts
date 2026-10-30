export const runtime = 'edge';

export async function GET() {
  return Response.json([]);
}

export async function POST() {
  return Response.json({ ok: true });
}
