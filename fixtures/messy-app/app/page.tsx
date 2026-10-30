'use client';
import { useEffect, useState } from 'react';
import { formatDate } from '@/lib/date';
import { formatDay } from '@/lib/date-utils';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [rows, setRows] = useState<{ id: string; created: string }[]>([]);
  useEffect(() => {
    supabase.from('orders').select('*').then(({ data }) => setRows(data ?? []));
  }, []);
  const secret = process.env.STRIPE_SECRET_KEY;
  return (
    <ul data-k={secret ? 'y' : 'n'}>
      {rows.map((r) => (
        <li key={r.id}>
          {formatDate(r.created)} {formatDay(r.created)}
        </li>
      ))}
    </ul>
  );
}
