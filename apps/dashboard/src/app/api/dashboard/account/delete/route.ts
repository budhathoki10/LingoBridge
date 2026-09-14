import { withServices } from "@/server/container";
import { handleDeleteAccount } from "@/server/handlers/dashboard-api";

export const dynamic = "force-dynamic";
export const POST = withServices(handleDeleteAccount);
