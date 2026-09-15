import { withServices } from "@/server/container";
import { handleSignOut } from "@/server/handlers/auth";

export const dynamic = "force-dynamic";
export const POST = withServices(handleSignOut);
