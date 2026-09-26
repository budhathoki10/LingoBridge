/**
 * Titles and descriptions for the dashboard pages. Each page and its loading placeholder read from
 * here, so the placeholder's header is the same text and wraps to the same height.
 */
export const PAGE_COPY = {
  admin: {
    description:
      "Provider health and usage totals for this gateway instance. No selected, translated, or saved text is ever shown here.",
    title: "Operations",
  },
  extensions: {
    description:
      "Each Chrome installation you approved has its own connection. Revoking one refuses its very next sync, and its local phrases stay on that device.",
    title: "Connected extensions",
  },
  overview: {
    description:
      "Phrases you chose to save in the extension, and the devices allowed to sync them.",
    title: "Overview",
  },
  phrases: {
    description:
      "Only phrases you explicitly saved in the extension. Translations you didn’t save are never stored.",
    title: "Saved phrases",
  },
  preferences: {
    description:
      "These settings sync to every connected extension. Settings tied to one browser stay on that device.",
    title: "Preferences",
  },
  privacy: {
    description: "Download what LingoBridge stores for this account, stop syncing, or delete it.",
    title: "Privacy and data",
  },
  vocabulary: {
    description: "Words you explicitly saved after requesting word-level understanding.",
    title: "My vocabulary",
  },
} as const;
