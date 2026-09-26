import { renderShareImage, SHARE_IMAGE_SIZE, SHARE_IMAGE_TYPE } from "@/lib/share-image";

export const alt =
  "LingoBridge privacy policy: what is sent, stored, and deleted when you translate selected text.";
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_TYPE;

export const privacyShareContent = {
  eyebrow: "Privacy policy",
  points: ["Selecting text sends nothing", "Only saved items sync", "Export or delete anytime"],
  subtitle: "What LingoBridge sends, stores, and deletes, and which providers receive your text.",
  title: "Your text, your decisions.",
} as const;

export default function Image() {
  return renderShareImage(privacyShareContent);
}
