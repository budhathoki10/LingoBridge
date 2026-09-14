import { withServices } from "@/server/container";
import { handleExport } from "@/server/handlers/dashboard-api";

export const dynamic = "force-dynamic";
export const GET = withServices(handleExport);
