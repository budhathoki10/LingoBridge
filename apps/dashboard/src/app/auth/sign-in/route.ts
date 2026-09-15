import { withServices } from "@/server/container";
import { handleSignInStart } from "@/server/handlers/auth";

export const dynamic = "force-dynamic";
export const GET = withServices(handleSignInStart);
