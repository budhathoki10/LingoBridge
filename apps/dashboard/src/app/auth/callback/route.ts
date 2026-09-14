import { withServices } from "@/server/container";
import { handleCallback } from "@/server/handlers/auth";

export const dynamic = "force-dynamic";
export const GET = withServices(handleCallback);
