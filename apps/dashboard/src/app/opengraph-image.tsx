import { renderShareImage, SHARE_IMAGE_SIZE, SHARE_IMAGE_TYPE } from "@/lib/share-image";

export const alt =
  "LingoBridge: Understand the words in front of you. A Chrome extension that translates selected text beside it.";
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_TYPE;

export const homeShareContent = {
  eyebrow: "Chrome extension",
  points: ["Free to install", "Account optional", "Translates only after your click"],
  subtitle: "Select text, click once, and read the translation beside it. Save only what matters.",
  title: "Understand the words in front of you.",
} as const;

export default function Image() {
  return renderShareImage(homeShareContent);
}
