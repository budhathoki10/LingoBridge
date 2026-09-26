/** Copy shared by the preferences page, its form, and its loading placeholder. */
export const PREFERENCES_COPY = {
  deviceOnly: {
    body: "Website access for Selection Magic, disabled websites, sensitive-text confirmations, and Online consent never leave the browser where you chose them. Change them from the extension popup on that device.",
    title: "Kept on each device",
  },
  language: {
    help: "Selection Magic translates into this language unless you pick another.",
    title: "Preferred translation language",
  },
  processing: {
    help: "Where translation runs by default.",
    onDevice: {
      detail: "Not available yet. Chrome’s built-in translator doesn’t support Nepali.",
      label: "On-device",
    },
    online: {
      detail: "NVIDIA Nemotron first, then MyMemory, then NVIDIA Riva where supported.",
      label: "Online",
    },
    title: "Processing",
  },
  sync: {
    help: "When on, phrases you save in a connected extension are copied to this account. Turning it off keeps existing synced phrases until you delete them.",
    title: "Phrase sync",
  },
} as const;
