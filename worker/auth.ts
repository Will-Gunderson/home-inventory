// Single-user passcode login. The session cookie is `<expiry>.<hmac(expiry)>`,
// signed with SESSION_SECRET, so no session table is needed.

const COOKIE = "hi_session";
const MAX_AGE_DAYS = 180;

const enc = new TextEncoder();

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

export async function checkPasscode(env: Env, passcode: string): Promise<boolean> {
  if (!env.APP_PASSCODE) return false;
  // Compare HMACs so length differences don't leak through timing.
  const [a, b] = await Promise.all([
    hmac(env.SESSION_SECRET, passcode),
    hmac(env.SESSION_SECRET, env.APP_PASSCODE),
  ]);
  return timingSafeEqual(a, b);
}

export async function sessionCookie(env: Env, secure: boolean): Promise<string> {
  const exp = Date.now() + MAX_AGE_DAYS * 86400_000;
  const value = `${exp}.${await hmac(env.SESSION_SECRET, String(exp))}`;
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_DAYS * 86400}${secure ? "; Secure" : ""}`;
}

export function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function isAuthed(env: Env, cookieHeader: string | null): Promise<boolean> {
  if (!cookieHeader || !env.SESSION_SECRET) return false;
  const match = cookieHeader.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  if (!match) return false;
  const [exp, sig] = match.slice(COOKIE.length + 1).split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return timingSafeEqual(sig, await hmac(env.SESSION_SECRET, exp));
}
