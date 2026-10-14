import { requireCloudOwner } from "../../../../lib/cloud-auth";
import { parseSessionPayload, readSessionBody, requireSameOrigin } from "../../../../lib/cloud-contract.mjs";
import { cloudError, cloudJson } from "../../../../lib/cloud-responses";
import { deleteCloudSession, getCloudSession, updateCloudSession } from "../../../../lib/cloud-sessions";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const owner = await requireCloudOwner(request);
    const { id } = await context.params;
    return cloudJson({ session: await getCloudSession(owner, id) });
  } catch (error) {
    return cloudError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const owner = await requireCloudOwner(request);
    const { id } = await context.params;
    const payload = parseSessionPayload(await readSessionBody(request), "patch");
    return cloudJson({ session: await updateCloudSession(owner, id, payload) });
  } catch (error) {
    return cloudError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const owner = await requireCloudOwner(request);
    requireSameOrigin(request);
    const { id } = await context.params;
    await deleteCloudSession(owner, id);
    return cloudJson({ ok: true });
  } catch (error) {
    return cloudError(error);
  }
}
