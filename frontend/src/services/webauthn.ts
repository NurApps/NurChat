import { api } from "./api"

/**
 * Passkeys (WebAuthn) на чистом navigator.credentials — без зависимостей.
 *
 * Сервер отдаёт options с base64url-строками (challenge, user.id,
 * credential id) — здесь они превращаются в ArrayBuffer для браузера
 * и обратно для verify. Если браузер/вью не умеет WebAuthn
 * (старый WebView2, tauri://-нюансы) — вызыватель прячет кнопки,
 * TOTP остаётся фолбэком.
 */

export function isPasskeySupported(): boolean {
  try {
    return (
      typeof window !== "undefined" &&
      typeof window.PublicKeyCredential !== "undefined" &&
      !!navigator.credentials?.create &&
      !!navigator.credentials?.get &&
      window.isSecureContext
    );
  } catch {
    return false;
  }
}

export function b64urlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toAttestationOptions(publicKey: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const pk = { ...publicKey } as Record<string, unknown>;
  return {
    ...(pk as object),
    challenge: b64urlToBytes(pk.challenge as string),
    user: {
      ...((pk.user as Record<string, unknown>) ?? {}),
      id: b64urlToBytes((pk.user as Record<string, unknown>).id as string),
    },
    excludeCredentials: ((pk.excludeCredentials as Array<Record<string, unknown>>) ?? []).map((c) => ({
      ...c,
      id: b64urlToBytes(c.id as string),
      type: "public-key" as const,
    })),
  } as PublicKeyCredentialCreationOptions;
}

function attestationToJSON(cred: PublicKeyCredential): Record<string, unknown> {
  const resp = cred.response as AuthenticatorAttestationResponse;
  const out: Record<string, unknown> = {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: bytesToB64url(resp.clientDataJSON),
      attestationObject: bytesToB64url(resp.attestationObject),
    },
  };
  const transports = (resp as { getTransports?: () => string[] }).getTransports?.();
  if (transports) (out.response as Record<string, unknown>).transports = transports;
  return out;
}

function toAssertionOptions(publicKey: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const pk = { ...publicKey } as Record<string, unknown>;
  return {
    ...(pk as object),
    challenge: b64urlToBytes(pk.challenge as string),
    allowCredentials: ((pk.allowCredentials as Array<Record<string, unknown>>) ?? []).map((c) => ({
      ...c,
      id: b64urlToBytes(c.id as string),
      type: "public-key" as const,
    })),
  } as PublicKeyCredentialRequestOptions;
}

function assertionToJSON(cred: PublicKeyCredential): Record<string, unknown> {
  const resp = cred.response as AuthenticatorAssertionResponse;
  const out: Record<string, unknown> = {
    id: cred.id,
    rawId: bytesToB64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bytesToB64url(resp.authenticatorData),
      clientDataJSON: bytesToB64url(resp.clientDataJSON),
      signature: bytesToB64url(resp.signature),
    },
  };
  if (resp.userHandle) (out.response as Record<string, unknown>).userHandle = bytesToB64url(resp.userHandle);
  return out;
}

export interface PasskeyCredential {
  id: number;
  name: string;
  created_at: string | null;
}

/** Привязка нового passkey (нужна активная сессия). Возвращает созданный ключ. */
export async function registerPasskey(name: string): Promise<PasskeyCredential> {
  const options = await api.webauthnRegisterOptions(window.location.origin);
  const cred = (await navigator.credentials.create({
    publicKey: toAttestationOptions(options as unknown as Record<string, unknown>),
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("ceremony-cancelled");
  const res = await api.webauthnRegisterVerify(
    attestationToJSON(cred),
    window.location.origin,
    name,
  );
  return (res as { credential: PasskeyCredential }).credential;
}

export interface PasskeyLoginResult {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  user: {
    id: string;
    username: string;
    first_name: string;
    last_name: string;
  } | null;
  requires_2fa?: boolean;
}

/** Вход по passkey: username → options → аутентификатор → verify → сессия. */
export async function loginWithPasskey(username: string): Promise<PasskeyLoginResult> {
  const options = await api.webauthnLoginOptions(username.trim(), window.location.origin);
  const cred = (await navigator.credentials.get({
    publicKey: toAssertionOptions(options as unknown as Record<string, unknown>),
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("ceremony-cancelled");
  return (await api.webauthnLoginVerify(
    username.trim(),
    assertionToJSON(cred),
    window.location.origin,
  )) as PasskeyLoginResult;
}
