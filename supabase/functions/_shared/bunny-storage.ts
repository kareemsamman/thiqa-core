export function normalizeBunnyCdnUrl(rawCdnUrl: string | null | undefined): string {
  const fallback = "https://cdn.thiqacrm.com";
  const input = (rawCdnUrl || "").trim();
  if (!input) return fallback;

  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return withProtocol.replace(/\/+$/, "");
}

export function resolveBunnyStorageZone(
  rawStorageZone: string | null | undefined,
  rawCdnUrl: string | null | undefined,
): string | null {
  const storageInput = (rawStorageZone || "").trim();
  const cdnInput = (rawCdnUrl || "").trim();

  let normalizedStorage = storageInput
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");

  if (!normalizedStorage) {
    return null;
  }

  if (normalizedStorage.includes("/")) {
    const parts = normalizedStorage.split("/").filter(Boolean);
    if (parts[0] === "storage.bunnycdn.com" && parts[1]) {
      normalizedStorage = parts[1];
    } else {
      normalizedStorage = parts[0];
    }
  }

  if (normalizedStorage === "storage.bunnycdn.com") {
    const cdnHost = cdnInput
      .replace(/^https?:\/\//i, "")
      .split("/")[0]
      .trim();
    const inferredZone = cdnHost.split(".")[0]?.trim();
    return inferredZone || null;
  }

  return normalizedStorage;
}

export function buildBunnyStorageUploadUrl(storageZone: string, storagePath: string): string {
  const safeStorageZone = storageZone.trim().replace(/^\/+|\/+$/g, "");
  const safeStoragePath = storagePath.trim().replace(/^\/+/, "");
  return `https://storage.bunnycdn.com/${safeStorageZone}/${safeStoragePath}`;
}
