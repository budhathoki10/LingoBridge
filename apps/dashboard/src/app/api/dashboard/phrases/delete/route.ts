import { withServices } from "@/server/container";
import { handleDeletePhrases } from "@/server/handlers/dashboard-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleDeletePhrases);
