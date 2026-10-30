export function discountFor(user: { vip: boolean; orders: number; country: string }, total: number): number {
  let discount = 0;
  if (user.vip) {
    if (total > 1000) {
      if (user.country === 'SE' || user.country === 'NO') {
        discount = 0.2;
      } else {
        discount = 0.15;
      }
    } else if (total > 500) {
      discount = 0.1;
    }
  } else {
    for (let i = 0; i < user.orders; i++) {
      if (i > 10 && total > 200) {
        discount += 0.01;
        if (discount > 0.1) {
          break;
        }
      }
    }
  }
  return discount;
}
