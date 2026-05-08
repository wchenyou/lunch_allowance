import { timingSafeEqual, randomBytes, scrypt as scryptCallback } from "node:crypto";
const KEY_LENGTH = 64;

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$16384$8$1$${salt}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, encoded: string | null | undefined) {
  if (!password || !encoded) return false;
  const [scheme, n, r, p, salt, hash] = encoded.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scrypt(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function scrypt(password: string, salt: string, keylen: number, options?: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, keylen, options ?? {}, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}
