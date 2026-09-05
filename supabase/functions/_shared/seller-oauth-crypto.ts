// Standard Web Crypto only. Ciphertexts are bound to tenant, environment and purpose.
const encoder = new TextEncoder();
export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll(
    "/",
    "_",
  ).replace(/=+$/, "");
}
function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (c) => c.charCodeAt(0),
  );
}
export function randomSecret(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export async function digest(value: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", encoder.encode(value)),
    ),
  );
}
export function authorizationUrl(
  clientId: string,
  redirect: string,
  state: string,
  challenge: string,
): string {
  if (
    !/^\d+$/.test(clientId) || new URL(redirect).protocol !== "https:" ||
    !/^[\w-]{43}$/.test(state)
  ) throw new Error("Invalid OAuth configuration");
  const url = new URL("https://auth.mercadopago.com.ar/authorization");
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    platform_id: "mp",
    redirect_uri: redirect,
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "read write offline_access",
  }).toString();
  return url.toString();
}
function key(secret: string): Promise<CryptoKey> {
  const bytes = decode(secret);
  if (bytes.length !== 32) throw new Error("Invalid encryption key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
export async function seal(
  value: unknown,
  secret: string,
  context: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(context) },
    await key(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}
export async function unseal(
  value: string,
  secret: string,
  context: string,
): Promise<Record<string, unknown>> {
  const [version, iv, ciphertext, extra] = value.split(".");
  if (version !== "v1" || !iv || !ciphertext || extra) {
    throw new Error("Invalid protected material");
  }
  const result = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(iv),
      additionalData: encoder.encode(context),
    },
    await key(secret),
    decode(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(result));
}
export function parseCallback(
  url: URL,
): { state: string; code: string; denied: boolean } {
  if (
    ["state", "code", "error"].some((name) =>
      url.searchParams.getAll(name).length > 1
    )
  ) throw new Error("Invalid callback");
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const denied = url.searchParams.has("error");
  if (
    !/^[\w-]{43}$/.test(state) || (!denied && (!code || code.length > 2048)) ||
    (denied && code)
  ) throw new Error("Invalid callback");
  return { state, code, denied };
}
