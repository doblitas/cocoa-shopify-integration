export type ShopifyProductVariant = {
  id: number;
  sku: string | null;
  price: string;
  inventory_quantity: number | null;
};

export type ShopifyProductImage = {
  src: string;
};

export type ShopifyProductWebhookPayload = {
  id: number;
  title: string;
  body_html?: string | null;
  product_type?: string | null;
  tags?: string | null;
  variants: ShopifyProductVariant[];
  image?: ShopifyProductImage | null;
  images?: ShopifyProductImage[];
};

