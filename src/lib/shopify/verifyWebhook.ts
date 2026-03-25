import crypto from "node:crypto";

function safeStringCompare(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a, "utf8");
  const bBuffer = Buffer.from(b, "utf8");
  if (aBuffer.length !== bBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function verifyShopifyWebhookSignature(
  rawBody: string,
  webhookSecret: string,
  receivedHmac: string,
): boolean {
  const digest = crypto.createHmac("sha256", webhookSecret).update(rawBody, "utf8").digest("base64");
  return safeStringCompare(digest, receivedHmac);
}

