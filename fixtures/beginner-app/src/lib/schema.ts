import { z } from 'zod';

export const userSchema = z.object({ name: z.string() });
export type User = z.infer<typeof userSchema>;

export const supabaseUrl = 'https://x.supabase.co';
export const client = { url: supabaseUrl };
