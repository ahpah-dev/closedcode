import { getCloudOwner } from "../../../lib/cloud-auth";
import { cloudJson } from "../../../lib/cloud-responses";
import { checkCloudDatabase, cloudSessionStats } from "../../../lib/cloud-sessions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const owner = await getCloudOwner(request);
  const started = Date.now();
  try {
    await checkCloudDatabase();
    const sessionStats = owner ? await cloudSessionStats(owner) : null;
    return cloudJson({
      name: "ClosedCode",
      status: "ready",
      checkedAt: new Date().toISOString(),
      database: { status: "ready", latencyMs: Date.now() - started },
      authenticated: owner !== null,
      sessions: sessionStats,
      agentRuntime: { location: "local-companion", connection: "client-managed", companionRequired: true },
    });
  } catch (error) {
    console.error("ClosedCode database health check failed", error);
    return cloudJson({
      name: "ClosedCode",
      status: "degraded",
      checkedAt: new Date().toISOString(),
      database: { status: "unavailable", latencyMs: Date.now() - started },
      authenticated: owner !== null,
      sessions: null,
      agentRuntime: { location: "local-companion", connection: "client-managed", companionRequired: true },
    }, 503);
  }
}
