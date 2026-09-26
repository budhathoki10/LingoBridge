import { plural } from "@/lib/format";

/** Copy shared by the privacy actions and their loading placeholder. */
export const PRIVACY_COPY = {
  dataTitle: "Your data",
  deleteAccount: {
    body: "Deletes every synced phrase and preference, disconnects every extension, and signs you out. Phrases saved inside the extension on each device are not touched; each device asks whether to keep them.",
    confirmIdentity: "Confirm it’s you to continue",
    reauthHint: "For your protection, deleting an account needs a sign-in from the last 5 minutes.",
    title: "Delete account",
  },
  deletePhrases: { action: "Delete all phrases", title: "Delete synced phrases" },
  download: {
    action: "Download",
    body: "Your account details, preferences, saved phrases and words, and connected-extension history in a readable text file.",
    title: "Download account data",
  },
  sync: {
    off: "Off. New phrases stay only on the device where you saved them.",
    on: "Connected extensions upload phrases you save. Turn this off to keep new phrases only on each device.",
    title: "Phrase sync",
  },
} as const;

export function deletePhrasesDescription(phraseCount: number): string {
  return phraseCount === 0
    ? "No synced phrases are stored."
    : `Removes ${plural(phraseCount, "phrase")} from this account and from connected extensions at their next sync.`;
}
