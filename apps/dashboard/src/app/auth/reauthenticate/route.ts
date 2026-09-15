import { withServices } from "@/server/container";
import { handleReauthenticateStart } from "@/server/handlers/auth";

export const dynamic = "force-dynamic";
export const GET = withServices(handleReauthenticateStart);
