import { withServices } from "@/server/container";
import { handleUpdatePreferences } from "@/server/handlers/dashboard-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleUpdatePreferences);
