import { renderShareImage, SHARE_IMAGE_SIZE, SHARE_IMAGE_TYPE } from "@/lib/share-image";
import { alt as privacyAlt, privacyShareContent } from "./opengraph-image";

export const alt = privacyAlt;
export const size = SHARE_IMAGE_SIZE;
export const contentType = SHARE_IMAGE_TYPE;

export default function Image() {
  return renderShareImage(privacyShareContent);
}
