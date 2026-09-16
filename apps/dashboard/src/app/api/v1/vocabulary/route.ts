import { withServices } from "@/server/container";
import { handleVocabularyUpsert } from "@/server/handlers/extension-api";

export const POST = withServices(handleVocabularyUpsert);
