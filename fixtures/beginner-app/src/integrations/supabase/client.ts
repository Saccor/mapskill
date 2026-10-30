import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFiY2RlZmdoaWprbG1ub3AiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoyMDAwMDAwMDAwfQ.abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
