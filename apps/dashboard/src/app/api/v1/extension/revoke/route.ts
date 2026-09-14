import { withServices } from "@/server/container";
import { handleExtensionRevoke } from "@/server/handlers/extension-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleExtensionRevoke);
