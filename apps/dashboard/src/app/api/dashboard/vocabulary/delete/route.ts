import { withServices } from "@/server/container";
import { handleDeleteVocabulary } from "@/server/handlers/dashboard-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleDeleteVocabulary);
