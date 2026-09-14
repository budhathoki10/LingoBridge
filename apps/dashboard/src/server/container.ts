import "server-only";
import { loadDashboardConfig } from "./config";
import { createDashboardServices, type DashboardServices } from "./services";

const globalForServices = globalThis as typeof globalThis & {
  lingobridgeDashboardServices?: Promise<DashboardServices>;
};

/**
 * One set of services per server process. Development hot reloads re-evaluate modules, so the
 * instance lives on globalThis; otherwise each reload would open another embedded database.
 */
export function getServices(): Promise<DashboardServices> {
  globalForServices.lingobridgeDashboardServices ??= createDashboardServices(
    loadDashboardConfig(process.env),
  ).catch((error) => {
    globalForServices.lingobridgeDashboardServices = undefined;
    throw error;
  });
  return globalForServices.lingobridgeDashboardServices;
}

export function withServices(
  handler: (request: Request, services: DashboardServices) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => handler(request, await getServices());
}
