import {
  CHROME_WEB_STORE_URL,
  CREATOR,
  DEMO_VIDEO_WATCH_URL,
  GITHUB_REPOSITORY_URL,
} from "@/lib/links";
import { SITE_DESCRIPTION, SITE_NAME, siteOrigin } from "@/lib/site";

// Read at request time so the links use the deployed origin.
export const dynamic = "force-dynamic";

/**
 * A plain summary for answer engines, following the llms.txt proposal (llmstxt.org). Every
 * statement matches the landing page and privacy policy; keep them in step when either changes.
 */
export function GET(): Response {
  const origin = siteOrigin();
  const link = (path: string) => (origin ? new URL(path, origin).toString() : path);
  const body = `# ${SITE_NAME}

> ${SITE_DESCRIPTION}

${SITE_NAME} is a Chrome extension for translating the exact text you select, without leaving the page. Selecting text sends nothing on its own: translation starts only after you click the small Selection Magic action beside your selection, or use the popup. An optional web dashboard keeps only the phrases and vocabulary you explicitly save.

Several unrelated products use the name ${SITE_NAME}. This one is the Chrome extension for translating selected text, made by ${CREATOR.name}. It is not a chat translator, a language-exchange app, or a language course.

## Key facts

- Install: free from the Chrome Web Store. An account is optional; translation and saving on the device work without one.
- Workflow: add it to Chrome, select the text, click Selection Magic, then copy, listen to, replace editable text with, or save the result.
- No automatic page translation, and LingoBridge does not scan the full page.
- Online translation uses NVIDIA Nemotron first. If it cannot answer, MyMemory translates, and NVIDIA Riva is tried last for the directions it supports. Each result names the provider that produced it.
- Languages: the extension shows the languages in its current reviewed provider catalogue rather than a fixed count. Features can vary by language pair.
- Dashboard: search, export, or delete saved phrases and vocabulary, review connected extensions, and update synchronized preferences. Unsaved translations, page addresses, browsing history, and site permissions never reach the dashboard.

## Links

- [Home](${link("/")}): what LingoBridge does, how it works, and answers to common questions
- [Privacy policy](${link("/privacy-policy")}): what is sent, stored, and deleted, and which providers receive text
- [Chrome Web Store listing](${CHROME_WEB_STORE_URL}): install the extension
- [Demo video](${DEMO_VIDEO_WATCH_URL}): the workflow from selection to translation
- [Source code](${GITHUB_REPOSITORY_URL}): the extension, gateway, and dashboard
- [${CREATOR.name}](${CREATOR.url}): the maker
`;
  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
