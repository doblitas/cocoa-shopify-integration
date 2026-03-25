import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    ok: true,
    service: "cocoa-shopify-integration",
    timestamp: new Date().toISOString(),
  });
}

