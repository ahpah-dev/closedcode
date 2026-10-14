export type CloudSessionStatus = "idle" | "running" | "complete";

export type CloudMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

export type CloudSession = {
  id: string;
  title: string;
  agent: string;
  project: string;
  status: CloudSessionStatus;
  messages: CloudMessage[];
  createdAt: string;
  updatedAt: string;
};

export type SessionCreate = Pick<CloudSession, "title" | "agent" | "project" | "messages">;
export type SessionPatch = Partial<Pick<CloudSession, "title" | "agent" | "project" | "status" | "messages">>;

export class CloudRequestError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "CloudRequestError";
    this.status = status;
  }
}

export const MAX_SESSION_BODY_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 500;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, name: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string") throw new CloudRequestError(`${name} must be a string.`);
  const result = value.trim();
  if ((!allowEmpty && !result) || result.length > maxLength) {
    throw new CloudRequestError(`${name} must be ${allowEmpty ? "at most" : "between 1 and"} ${maxLength} characters.`);
  }
  return result;
}

function parseMessages(value: unknown): CloudMessage[] {
  if (!Array.isArray(value) || value.length > MAX_MESSAGES) {
    throw new CloudRequestError(`messages must be an array with at most ${MAX_MESSAGES} entries.`);
  }
  const ids = new Set<string>();
  return value.map((message, index) => {
    if (!isObject(message)) throw new CloudRequestError(`messages[${index}] must be an object.`);
    const allowed = ["id", "role", "content", "createdAt"];
    if (Object.keys(message).some((key) => !allowed.includes(key))) {
      throw new CloudRequestError(`messages[${index}] contains an unsupported field.`);
    }
    const id = boundedString(message.id, `messages[${index}].id`, 128);
    if (ids.has(id)) throw new CloudRequestError("Message IDs must be unique within a session.");
    ids.add(id);
    if (message.role !== "user" && message.role !== "assistant") {
      throw new CloudRequestError(`messages[${index}].role must be user or assistant.`);
    }
    if (typeof message.content !== "string" || message.content.length > 131_072) {
      throw new CloudRequestError(`messages[${index}].content must be a string of at most 131072 characters.`);
    }
    if (typeof message.createdAt !== "string" || message.createdAt.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(message.createdAt) || !Number.isFinite(Date.parse(message.createdAt))) {
      throw new CloudRequestError(`messages[${index}].createdAt must be an ISO timestamp.`);
    }
    return { id, role: message.role, content: message.content, createdAt: new Date(message.createdAt).toISOString() };
  });
}

export function parseSessionPayload(value: unknown, mode: "create"): SessionCreate;
export function parseSessionPayload(value: unknown, mode: "patch"): SessionPatch;
export function parseSessionPayload(value: unknown, mode: "create" | "patch"): SessionCreate | SessionPatch {
  if (!isObject(value)) throw new CloudRequestError("The request body must be a JSON object.");
  const allowed = mode === "create" ? ["title", "agent", "project", "messages"] : ["title", "agent", "project", "messages", "status"];
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key))) throw new CloudRequestError("The request body contains an unsupported field.");
  if (mode === "patch" && keys.length === 0) throw new CloudRequestError("Provide at least one session field to update.");
  const result: SessionPatch = {};
  if (mode === "create" || "title" in value) result.title = boundedString(value.title, "title", 160);
  if (mode === "create" || "agent" in value) result.agent = boundedString(value.agent, "agent", 64);
  if (mode === "create" || "project" in value) result.project = boundedString(value.project, "project", 512, true);
  if ("messages" in value) result.messages = parseMessages(value.messages);
  else if (mode === "create") result.messages = [];
  if ("status" in value) {
    if (value.status !== "idle" && value.status !== "running" && value.status !== "complete") {
      throw new CloudRequestError("status must be idle, running, or complete.");
    }
    result.status = value.status;
  }
  return result as SessionCreate | SessionPatch;
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin !== null && origin !== new URL(request.url).origin)) {
    throw new CloudRequestError("Cross-origin session writes are not allowed.", 403);
  }
}

export async function readSessionBody(request: Request): Promise<unknown> {
  requireSameOrigin(request);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
    throw new CloudRequestError("Content-Type must be application/json.", 415);
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_SESSION_BODY_BYTES)) {
    throw new CloudRequestError(`The request body exceeds ${MAX_SESSION_BODY_BYTES} bytes.`, 413);
  }
  if (!request.body) throw new CloudRequestError("A JSON request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SESSION_BODY_BYTES) {
        await reader.cancel();
        throw new CloudRequestError(`The request body exceeds ${MAX_SESSION_BODY_BYTES} bytes.`, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CloudRequestError("The request body must contain valid JSON.");
  }
}

export function validateSessionId(id: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new CloudRequestError("Session not found.", 404);
  }
  return id;
}
