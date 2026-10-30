export async function notify(url: string) {
  try {
    await fetch(url, { method: 'POST' });
  } catch (e) {}
}
