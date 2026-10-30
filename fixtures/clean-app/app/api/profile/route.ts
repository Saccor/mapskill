import { getProfile } from '@/lib/profiles';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('id') ?? '';
  const profile = await getProfile(id);
  return Response.json(profile);
}
