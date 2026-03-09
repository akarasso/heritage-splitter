export function isPublicDomain(): boolean {
  return false;
}

export function getPublicSaleUrl(slug: string): string {
  return `${window.location.origin}/sale/${slug}`;
}

export function getMainAppUrl(path: string = "/"): string {
  return `${window.location.origin}${path}`;
}
