import { hash, verify } from '@node-rs/argon2';

// argon2id (library default algorithm), OWASP-recommended parameters.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashValue: string, password: string): Promise<boolean> {
  try {
    return await verify(hashValue, password);
  } catch {
    return false;
  }
}

// A real hash of a random string, used to keep login timing constant for unknown users.
let dummyHash: string | null = null;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= await hash('not-a-real-password-' + Math.random(), OPTIONS);
  await verifyPassword(dummyHash, password);
}
