import Stripe from 'stripe';
import { discountFor } from '@/lib/discount';
import { notify } from '@/lib/notify';
import { a } from '@/lib/cycle-a';

const stripe = new Stripe('sk_live_51HxAbCdEfGhIjKlMnOpQr');

export async function POST(request: Request) {
  const body = await request.json();
  const rate = discountFor(body.user, body.total);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: body.items,
    metadata: { rate: String(rate), depth: String(a(3)) },
  });
  await notify('https://example.com/hook');
  return Response.json({ url: session.url });
}
