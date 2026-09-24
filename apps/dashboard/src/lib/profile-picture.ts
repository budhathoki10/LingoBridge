/**
 * Google serves account photos from this origin. The Content-Security-Policy allows images from it
 * and nowhere else, so any other picture URL is not shown and the initials are used instead.
 */
export const PROFILE_PICTURE_ORIGIN = "https://lh3.googleusercontent.com";

export function displayablePictureUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin === PROFILE_PICTURE_ORIGIN ? url : null;
  } catch {
    return null;
  }
}
