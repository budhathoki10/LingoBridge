import { getServices } from "@/server/container";

export const dynamic = "force-dynamic";

/** Served only when the development identity provider is enabled; production returns 404. */
async function handle(request: Request): Promise<Response> {
  const services = await getServices();
  if (!services.developmentIdentity || services.config.production) {
    return new Response("Not found", { status: 404 });
  }
  return services.developmentIdentity.handle(request);
}

export const GET = handle;
export const POST = handle;
