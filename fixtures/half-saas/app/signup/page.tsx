'use client';
import { supabase } from '@/lib/supabase';

export default function SignupPage() {
  async function signUp(form: FormData) {
    await supabase.auth.signUp({ email: String(form.get('email')), password: String(form.get('password')) });
  }
  return (
    <form action={signUp}>
      <input name="email" /> <input name="password" type="password" /> <button>Sign up</button>
    </form>
  );
}
