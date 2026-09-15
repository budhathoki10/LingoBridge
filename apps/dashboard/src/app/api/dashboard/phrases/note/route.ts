import { withServices } from "@/server/container";
import { handleUpdateNote } from "@/server/handlers/dashboard-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleUpdateNote);
