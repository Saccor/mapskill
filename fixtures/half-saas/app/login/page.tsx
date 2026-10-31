'use client';
import { supabase } from '@/lib/supabase';

export default function LoginPage() {
  async function logIn(form: FormData) {
    await supabase.auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) });
  }
  return (
    <form action={logIn}>
      <input name="email" /> <input name="password" type="password" /> <button>Log in</button>
    </form>
  );
}
