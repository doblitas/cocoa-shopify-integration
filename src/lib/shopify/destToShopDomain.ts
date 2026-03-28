/** JWT `dest` is typically `https://shop.myshopify.com` */
export function destToShopDomain(dest: string): string {
  try {
    const u = new URL(dest);
    return u.hostname.toLowerCase();
  } catch {
    return dest.replace(/^https?:\/\//, "").split("/")[0]?.toLowerCase() ?? "";
  }
}
