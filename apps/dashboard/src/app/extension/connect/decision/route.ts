import { withServices } from "@/server/container";
import { handleConnectDecision } from "@/server/handlers/extension-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleConnectDecision);
