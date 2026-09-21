"use client";

import Image from "next/image";
import { useState } from "react";
import styles from "@/app/landing.module.css";
import { DEMO_VIDEO_EMBED_URL } from "@/lib/links";
import { PlayIcon } from "./icons";

export function VideoEmbed() {
  const [playing, setPlaying] = useState(false);

  return (
    <div className={styles.videoFrame} data-lb-reveal="">
      {playing ? (
        <iframe
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          src={`${DEMO_VIDEO_EMBED_URL}&autoplay=1`}
          title="LingoBridge product demonstration"
        />
      ) : (
        <button
          aria-label="Play the LingoBridge product demonstration"
          className={styles.videoPoster}
          onClick={() => setPlaying(true)}
          type="button"
        >
          <Image
            alt="LingoBridge translating selected text and explaining a chosen word on a webpage"
            className={styles.videoPosterImage}
            fill
            sizes="(max-width: 1200px) calc(100vw - 40px), 1180px"
            src="/lingobridge-demo.jpg"
          />
          <span className={styles.videoPosterShade} />
          <span className={styles.videoPlay}>
            <PlayIcon size={18} />
            Play demo
          </span>
        </button>
      )}
    </div>
  );
}
