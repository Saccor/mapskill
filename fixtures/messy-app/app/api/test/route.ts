const apiKey = 'sk_live_51ZyXwVuTsRqPoNmLkJiHg';

export async function GET() {
  return Response.json({ configured: apiKey.length > 0 });
}
