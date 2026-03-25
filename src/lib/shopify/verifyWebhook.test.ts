import crypto from "node:crypto";
import { describe, expect, it } from "vitest";

import { verifyShopifyWebhookSignature } from "@/lib/shopify/verifyWebhook";

describe("verifyShopifyWebhookSignature", () => {
  it("accepts a valid HMAC for the raw body", () => {
    const secret = "test-secret";
    const rawBody = '{"id":1}';
    const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    expect(verifyShopifyWebhookSignature(rawBody, secret, expected)).toBe(true);
  });

  it("rejects tampered body", () => {
    const secret = "test-secret";
    const rawBody = '{"id":1}';
    const wrong = "AAAA";
    expect(verifyShopifyWebhookSignature(rawBody, secret, wrong)).toBe(false);
  });
});
