import { ProfileCard } from '@/components/ProfileCard';
import { getProfile } from '@/lib/profiles';

export default async function Home() {
  const profile = await getProfile('1');
  return (
    <main>
      <ProfileCard name={profile.name} />
    </main>
  );
}
