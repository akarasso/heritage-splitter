const MAIN_DOMAIN = import.meta.env.VITE_MAIN_DOMAIN || "dev.heritage-splitter.test";
const PUBLIC_DOMAIN = import.meta.env.VITE_PUBLIC_DOMAIN || "dev.public.heritage-splitter.test";

export function isPublicDomain(): boolean {
  return window.location.hostname === PUBLIC_DOMAIN;
}

export function getPublicSaleUrl(slug: string): string {
  const proto = window.location.protocol;
  const port = window.location.port;
  const portSuffix = port && port !== "80" && port !== "443" ? `:${port}` : "";
  return `${proto}//${PUBLIC_DOMAIN}${portSuffix}/sale/${slug}`;
}

export function getMainAppUrl(path: string = "/"): string {
  const proto = window.location.protocol;
  const port = window.location.port;
  const portSuffix = port && port !== "80" && port !== "443" ? `:${port}` : "";
  return `${proto}//${MAIN_DOMAIN}${portSuffix}${path}`;
}
