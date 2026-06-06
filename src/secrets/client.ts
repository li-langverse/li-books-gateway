/** Resolve user-scoped secrets from li-books-secrets-api (Vault-backed). */

export type SecretsClientOptions = {
  baseUrl: string;
  userJwt: string;
};

export async function readUserSecret(
  name: string,
  opts: SecretsClientOptions
): Promise<Record<string, string> | null> {
  const encoded = encodeURIComponent(name);
  const res = await fetch(`${opts.baseUrl.replace(/\/$/, "")}/v1/secrets/${encoded}`, {
    headers: {
      Authorization: opts.userJwt.startsWith("Bearer ") ? opts.userJwt : `Bearer ${opts.userJwt}`,
      "x-internal-read": "gateway",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`secrets_read_failed:${res.status}`);
  const body = (await res.json()) as { data?: Record<string, string> };
  return body.data ?? null;
}

export function secretsApiBaseFromEnv(): string {
  return (
    process.env.SECRETS_API_URL?.trim() ||
    process.env.VAULT_API_URL?.trim() ||
    "http://127.0.0.1:8083"
  );
}
