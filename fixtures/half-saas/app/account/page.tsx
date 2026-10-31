import { getProfile } from '@/lib/profiles';

export default async function AccountPage() {
  const profile = await getProfile('me');
  return <main>Hello {profile.name}</main>;
}
