export function cartTotal(items: { price: number; qty: number }[]): number {
  let total = 0;
  for (const item of items) {
    const line = item.price * item.qty;
    total += line;
  }
  const tax = total * 0.25;
  const shipping = total > 500 ? 0 : 49;
  const sum = total + tax + shipping;
  const rounded = Math.round(sum * 100) / 100;
  const fee = rounded > 0 ? 5 : 0;
  const final = rounded + fee;
  return final;
}

export function orderTotal(items: { price: number; qty: number }[]): number {
  let total = 0;
  for (const item of items) {
    const line = item.price * item.qty;
    total += line;
  }
  const tax = total * 0.25;
  const shipping = total >= 500 ? 0 : 49;
  const sum = total + tax + shipping;
  const rounded = Math.round(sum * 100) / 100;
  const fee = rounded > 0 ? 5 : 0;
  const final = rounded + fee;
  return final;
}
