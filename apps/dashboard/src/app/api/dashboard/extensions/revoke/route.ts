import { withServices } from "@/server/container";
import { handleRevokeExtension } from "@/server/handlers/dashboard-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleRevokeExtension);
