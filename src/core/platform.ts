/**
 * The claude.ai Artifact viewer's runtime (window.claude), when the game runs inside one.
 * Pages there can't start downloads themselves; saving a file goes through the viewer's
 * `downloads` capability, which asks the player to confirm.
 */
export interface PlatformDownloads {
  save(req: { filename: string; data: Blob | string | ArrayBuffer }): Promise<{ status: 'saved' | 'delivered' }>;
}

let downloads: Promise<PlatformDownloads | null> | null = null;

/** The viewer's downloads capability, or null outside the viewer (or when it isn't granted). */
export function platformDownloads(): Promise<PlatformDownloads | null> {
  if (!downloads) {
    const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
    downloads = claude?.use
      ? claude.use('downloads').then(
          (d) => (d as PlatformDownloads | null) ?? null,
          () => null,
        )
      : Promise.resolve(null);
  }
  return downloads;
}

export function dataUrlToBlob(url: string): Blob {
  const comma = url.indexOf(',');
  const type = url.slice(5, url.indexOf(';')) || 'application/octet-stream';
  const bin = atob(url.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
