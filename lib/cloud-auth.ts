import { getChatGPTUser, chatGPTSignInPath } from "../app/chatgpt-auth";
import { CloudRequestError } from "./cloud-contract.mjs";

export async function getCloudOwner(request: Request): Promise<string | null> {
  const user = await getChatGPTUser();
  if (user) return user.userId;
  // Portable development previews can save sessions before mock sign-in.
  // This branch is removed from production builds; hosted visitors need identity.
  const host = new URL(request.url).hostname.replace(/^\[|\]$/g, "");
  if (process.env.NODE_ENV === "development" && ["localhost", "127.0.0.1", "::1"].includes(host)) {
    return "closedcode-local-preview";
  }
  return null;
}

export async function requireCloudOwner(request: Request): Promise<string> {
  const owner = await getCloudOwner(request);
  if (!owner) throw new CloudRequestError("Sign in to save and access your coding sessions.", 401);
  return owner;
}

export function cloudSignInPath(): string {
  return chatGPTSignInPath("/");
}
