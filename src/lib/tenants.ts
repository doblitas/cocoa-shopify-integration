export type CocoaCredentials = {
  baseUrl: string;
  user: string;
  password: string;
};

export type TenantConfig = {
  tenantId: string;
  shopDomain: string;
  webhookSecret: string;
  adminAccessToken?: string;
  cocoa: CocoaCredentials;
  categoryMap?: Record<string, string>;
  defaultCategoryKey?: string;
};

type RawTenantConfig = {
  tenantId?: string;
  shopDomain?: string;
  webhookSecret?: string;
  adminAccessToken?: string;
  cocoa?: Partial<CocoaCredentials>;
  categoryMap?: Record<string, string>;
  defaultCategoryKey?: string;
};

function normalizeShopDomain(value: string): string {
  return value.trim().toLowerCase();
}

function assertTenant(raw: RawTenantConfig, index: number): TenantConfig {
  const prefix = `SHOPIFY_TENANTS_JSON[${index}]`;
  if (!raw.tenantId) {
    throw new Error(`${prefix}.tenantId is required`);
  }
  if (!raw.shopDomain) {
    throw new Error(`${prefix}.shopDomain is required`);
  }
  if (!raw.webhookSecret) {
    throw new Error(`${prefix}.webhookSecret is required`);
  }
  if (!raw.cocoa?.baseUrl || !raw.cocoa.user || !raw.cocoa.password) {
    throw new Error(`${prefix}.cocoa.baseUrl, cocoa.user and cocoa.password are required`);
  }

  return {
    tenantId: raw.tenantId,
    shopDomain: normalizeShopDomain(raw.shopDomain),
    webhookSecret: raw.webhookSecret,
    adminAccessToken: raw.adminAccessToken,
    cocoa: {
      baseUrl: raw.cocoa.baseUrl,
      user: raw.cocoa.user,
      password: raw.cocoa.password,
    },
    categoryMap: raw.categoryMap,
    defaultCategoryKey: raw.defaultCategoryKey,
  };
}

let tenantsCache: Map<string, TenantConfig> | null = null;

function loadTenants(): Map<string, TenantConfig> {
  if (tenantsCache) {
    return tenantsCache;
  }

  const rawJson = process.env.SHOPIFY_TENANTS_JSON;
  if (!rawJson) {
    throw new Error("Missing SHOPIFY_TENANTS_JSON environment variable");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error("SHOPIFY_TENANTS_JSON must be valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("SHOPIFY_TENANTS_JSON must be a JSON array");
  }

  const map = new Map<string, TenantConfig>();
  parsed.forEach((item, index) => {
    const tenant = assertTenant(item as RawTenantConfig, index);
    map.set(tenant.shopDomain, tenant);
  });

  tenantsCache = map;
  return map;
}

export function getTenantByShopDomain(shopDomain: string): TenantConfig | null {
  const normalized = normalizeShopDomain(shopDomain);
  return loadTenants().get(normalized) ?? null;
}

