import { client } from '@/lib/schema';
import { supabase } from '@/integrations/supabase/client';
import { UserCard } from '@/components/UserCard';
import { fmt } from '@/lib/db';
import { makeA, type A } from '@/lib/a';
import { makeB, type B } from '@/lib/b';
import type { Other } from '@/lib/local-types';
import { Counter } from '@/components/Counter';
import { Button } from '@/components/ui/button';

export default function Home() {
  const a: A = makeA();
  const b: B = makeB();
  const other: Other = { ok: true };
  return (
    <main>
      <UserCard user={{ name: client.url }} />
      <Counter />
      <Button label={fmt(1)} />
      {supabase ? fmt('x') : null}
      {a && b && other.ok ? 'ok' : 'no'}
    </main>
  );
}
