import { createHmac, timingSafeEqual } from "node:crypto";

const signaturePrefix = "sha256=";

export function signGithubWebhookBody(body: string | Buffer, secret: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(body);
  return `${signaturePrefix}${hmac.digest("hex")}`;
}

export function verifyGithubWebhookSignature(params: {
  rawBody: string | Buffer;
  signatureHeader: string | undefined;
  secret: string;
}): boolean {
  const { rawBody, signatureHeader, secret } = params;

  if (!signatureHeader?.startsWith(signaturePrefix)) {
    return false;
  }

  const expected = Buffer.from(signGithubWebhookBody(rawBody, secret), "utf8");
  const actual = Buffer.from(signatureHeader, "utf8");

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}
