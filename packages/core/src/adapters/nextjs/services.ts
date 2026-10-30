export interface Service {
  id: string;
  label: string;
  packages: string[];
}

export const SERVICES: Service[] = [
  { id: 'stripe', label: 'Stripe', packages: ['stripe', '@stripe/stripe-js', '@stripe/react-stripe-js'] },
  { id: 'openai', label: 'OpenAI', packages: ['openai'] },
  { id: 'anthropic', label: 'Anthropic', packages: ['@anthropic-ai/sdk'] },
  { id: 'resend', label: 'Resend', packages: ['resend'] },
  { id: 'clerk', label: 'Clerk', packages: ['@clerk/nextjs'] },
  { id: 'authjs', label: 'Auth.js', packages: ['next-auth', '@auth/core'] },
  { id: 'supabase', label: 'Supabase', packages: ['@supabase/supabase-js', '@supabase/ssr', '@supabase/auth-helpers-nextjs'] },
  { id: 'firebase', label: 'Firebase', packages: ['firebase', 'firebase-admin'] },
  { id: 'vercel-ai', label: 'Vercel AI SDK', packages: ['ai', '@ai-sdk/openai', '@ai-sdk/anthropic'] },
  { id: 'uploadthing', label: 'UploadThing', packages: ['uploadthing', '@uploadthing/react'] },
  { id: 'sentry', label: 'Sentry', packages: ['@sentry/nextjs'] },
  { id: 'posthog', label: 'PostHog', packages: ['posthog-js', 'posthog-node'] },
];

export function serviceForSpecifier(spec: string): Service | null {
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  return SERVICES.find((s) => s.packages.includes(pkg)) ?? null;
}
