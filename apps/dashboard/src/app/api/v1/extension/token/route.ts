import { withServices } from "@/server/container";
import { handleExtensionToken } from "@/server/handlers/extension-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleExtensionToken);
