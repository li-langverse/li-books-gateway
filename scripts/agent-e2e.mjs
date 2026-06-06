#!/usr/bin/env node
/** Agent e2e script — exercises tool flow against local gateway */
const base = process.env.BOOKS_GATEWAY_URL ?? "http://127.0.0.1:8092";

async function main(): Promise<number> {
  const health = await fetch(`${base}/healthz`);
  if (!health.ok) {
    console.error("gateway not reachable at", base);
    return 1;
  }
  const signup = await fetch(`${base}/v1/onboarding/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      org_name: "E2E Org",
      book_name: "Main",
      tax_domain: "freelance",
      tier: "free",
      user_id: "e2e-user",
    }),
  });
  const { org_id, book_id } = (await signup.json()) as { org_id: string; book_id: string };

  const parse = await fetch(`${base}/v1/receipts/parse`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ocr_text: "REWE\nTotal 25.00\n2024-06-01" }),
  });
  if (!parse.ok) return 1;

  const post = await fetch(`${base}/v1/receipts/post`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      org_id,
      book_id,
      amount: 25,
      spent_at: "2024-06-01",
      merchant: "REWE",
      category_code: "EXP_OFFICE",
    }),
  });
  if (!post.ok) return 1;

  const ustva = await fetch(
    `${base}/v1/export/elster/ustva?org_id=${org_id}&book_id=${book_id}&period_start=2024-06-01&period_end=2024-06-30`
  );
  const ustvaJson = (await ustva.json()) as { validation: { valid: boolean } };
  if (!ustvaJson.validation.valid) return 1;

  console.log("agent-e2e: OK");
  return 0;
}

main().then((c) => process.exit(c));
