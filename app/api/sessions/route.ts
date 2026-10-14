import { requireCloudOwner } from "../../../lib/cloud-auth";
import { parseSessionPayload, readSessionBody } from "../../../lib/cloud-contract.mjs";
import { cloudError, cloudJson } from "../../../lib/cloud-responses";
import { createCloudSession, listCloudSessions } from "../../../lib/cloud-sessions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const owner = await requireCloudOwner(request);
    return cloudJson({ sessions: await listCloudSessions(owner) });
  } catch (error) {
    return cloudError(error);
  }
}

export async function POST(request: Request) {
  try {
    const owner = await requireCloudOwner(request);
    const payload = parseSessionPayload(await readSessionBody(request), "create");
    return cloudJson({ session: await createCloudSession(owner, payload) }, 201);
  } catch (error) {
    return cloudError(error);
  }
}
