import { withServices } from "@/server/container";
import { handleSync } from "@/server/handlers/extension-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleSync);
