export const CHROME_EXTENSION_ID = "ioekknfcfhcohnjfhiodgielimgeobdf";

export const CHROME_WEB_STORE_URL =
  `https://chromewebstore.google.com/detail/lingobridge/${CHROME_EXTENSION_ID}` as const;

export const GITHUB_REPOSITORY_URL = "https://github.com/budhathoki10/LingoBridge" as const;

/** The maker's own site. Linking both ways tells search engines which LingoBridge this is. */
export const CREATOR = {
  name: "Kushal Budhathoki",
  url: "https://kushalbudhathoki.com.np",
} as const;

export const DEMO_VIDEO_ID = "KZHaoS9gsh0";
export const DEMO_VIDEO_EMBED_URL =
  `https://www.youtube-nocookie.com/embed/${DEMO_VIDEO_ID}?rel=0` as const;
export const DEMO_VIDEO_WATCH_URL = `https://youtu.be/${DEMO_VIDEO_ID}` as const;
