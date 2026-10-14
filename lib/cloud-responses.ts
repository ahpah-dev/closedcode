import { CloudRequestError } from "./cloud-contract.mjs";
import { cloudSignInPath } from "./cloud-auth";

export function cloudJson(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export function cloudError(error: unknown): Response {
  if (error instanceof CloudRequestError) {
    return cloudJson({ error: error.message, ...(error.status === 401 ? { signInUrl: cloudSignInPath() } : {}) }, error.status);
  }
  // Keep SQL, account IDs, and implementation details out of browser responses.
  console.error("ClosedCode session storage failed", error);
  return cloudJson({ error: "Session storage is unavailable. Check the database binding and migrations, then try again." }, 503);
}
