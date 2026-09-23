import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/noto-sans";
import type { Metadata } from "next";
import Link from "next/link";
import { Brand } from "@/components/brand";
import {
  ArrowRightIcon,
  BrowserIcon,
  CheckIcon,
  PhrasesIcon,
  PrivacyIcon,
  SearchIcon,
  VocabularyIcon,
} from "@/components/icons";
import { LandingAnimations } from "@/components/landing-animations";
import { TranslationStage } from "@/components/translation-stage";
import { VideoEmbed } from "@/components/video-embed";
import { CHROME_WEB_STORE_URL, DEMO_VIDEO_WATCH_URL } from "@/lib/links";
import styles from "./landing.module.css";

export const metadata: Metadata = {
  description:
    "Translate selected text where you read it, then keep only the phrases and vocabulary you choose in your private LingoBridge dashboard.",
  openGraph: {
    description:
      "Translate selected text without leaving the page. Save only what matters and manage it from the LingoBridge dashboard.",
    title: "LingoBridge | Understand the words in front of you",
    type: "website",
  },
  robots: { follow: true, index: true },
  title: "Understand the words in front of you",
};

const workflow = [
  {
    body: "Install LingoBridge from the Chrome Web Store. The popup works without broad page access.",
    title: "Add it to Chrome",
  },
  {
    body: "Highlight the exact sentence or phrase you want to understand. LingoBridge does not scan the full page.",
    title: "Select the text",
  },
  {
    body: "Choose the small LingoBridge action beside your selection. Nothing is sent merely because you selected text.",
    title: "Click Selection Magic",
  },
  {
    body: "Review the translated result, then copy, listen, replace editable text, or save it when useful.",
    title: "Use the result",
  },
] as const;

const trustPoints = [
  "Selecting text sends nothing on its own",
  "Translation starts only after your click",
  "Your dashboard keeps only what you save",
] as const;

const handled = [
  "Suggesting the source language after activation",
  "Loading your preferred target language",
  "Routing an Online request to an eligible provider",
  "Synchronizing items you explicitly saved",
] as const;

const decided = [
  "When translation starts",
  "Whether selected text can be processed Online",
  "Whether translated text replaces anything",
  "What is saved, synchronized, exported, or deleted",
] as const;

const deviceOnlyData = [
  {
    detail: "Used for the current action, then left out of your account.",
    label: "Temporary selection",
  },
  {
    detail: "Managed separately on each browser where you use LingoBridge.",
    label: "Site permissions",
  },
] as const;

const dashboardData = [
  {
    detail: "Saved locally first, then synchronized after you connect your account.",
    label: "Saved phrases and vocabulary",
  },
  {
    detail: "Search, export, or delete them from your dashboard at any time.",
    label: "Your saved library",
  },
] as const;

const faqs = [
  {
    answer:
      "No. Translation and local phrase saving work without an account. Sign in only when you want the web dashboard and synchronization across connected extensions.",
    question: "Do I need an account to translate?",
  },
  {
    answer:
      "No. Selecting text only reveals the Selection Magic action. Translation begins after you click it, and Online processing still follows your consent settings.",
    question: "Does LingoBridge translate pages automatically?",
  },
  {
    answer:
      "Only phrases, vocabulary, and approved preferences that you explicitly save can synchronize. Unsaved translations, browsing history, site permissions, and temporary selections are not added to your dashboard.",
    question: "What appears in my dashboard?",
  },
  {
    answer:
      "LingoBridge exposes the languages available in its current reviewed provider catalogue instead of advertising a fixed count. Individual features can vary by language pair.",
    question: "Which languages are supported?",
  },
  {
    answer:
      "Optional site access lets LingoBridge show the small action beside a stable selection. You can grant access for the current site, turn it off per site, or keep using the popup without it.",
    question: "Why does Selection Magic request site access?",
  },
  {
    answer:
      "Online translation uses MyMemory first and may use NVIDIA once as a fallback for supported directions. The result identifies the provider that produced it. Nepali is never sent to the unsupported NVIDIA translation fallback.",
    question: "Who processes an Online translation?",
  },
] as const;

function StoreLink({ className }: { className?: string }) {
  return (
    <a className={className} href={CHROME_WEB_STORE_URL} rel="noreferrer" target="_blank">
      Add to browser
      <ArrowRightIcon size={16} />
    </a>
  );
}

export default function HomePage() {
  return (
    <div className={styles.page} data-lb-landing-root="">
      <LandingAnimations />
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className={styles.siteHeader} data-lb-header="">
        <div className={styles.headerInner}>
          <Brand href="/" />
          <nav aria-label="Main navigation" className={styles.primaryNav}>
            <a href="#how-it-works">How it works</a>
            <a href="#automation">Control</a>
            <a href="#dashboard">Dashboard</a>
            <a href="#demo">Demo</a>
            <a href="#faq">FAQ</a>
          </nav>
          <div className={styles.headerActions}>
            <Link className={styles.dashboardLink} href="/overview">
              Sign in
            </Link>
            <StoreLink className={styles.headerCta} />
          </div>
        </div>
      </header>

      <main id="main">
        {/* 1. Hero */}
        <section className={styles.hero}>
          <div className={styles.heroInner}>
            <div className={styles.heroCopyBlock} data-lb-hero-copy="">
              <p className={styles.eyebrow}>
                <BrowserIcon size={14} />
                Chrome extension
              </p>
              <h1>
                <span>Understand the words</span>
                <span className={styles.heroAccent}>in front of you.</span>
              </h1>
              <p className={styles.heroCopy}>
                Select text, click the nearby action, and translate without leaving the page. Save
                only the phrases and vocabulary worth keeping.
              </p>
              <div className={styles.heroActions}>
                <StoreLink className={styles.primaryAction} />
                <a className={styles.secondaryAction} href="#demo">
                  Watch the demo
                </a>
              </div>
              <ul aria-label="Product availability" className={styles.heroNotes}>
                <li>
                  <CheckIcon size={14} /> Free to install
                </li>
                <li>
                  <CheckIcon size={14} /> Account optional
                </li>
              </ul>
            </div>
            <TranslationStage />
          </div>
        </section>

        {/* Trust strip: kept out of the hero so the hero stays short enough to
            show that the page continues, and so these three points read as one
            row rather than a list buried under the buttons. */}
        <section aria-label="What LingoBridge does not do" className={styles.trustStrip}>
          <ul className={styles.sectionInner} data-lb-stagger="">
            {trustPoints.map((point) => (
              <li key={point}>
                <CheckIcon size={16} />
                {point}
              </li>
            ))}
          </ul>
        </section>

        {/* 2. Product demo, centered */}
        <section className={styles.videoSection} id="demo">
          <div className={styles.videoInner}>
            <div className={styles.sectionLead} data-lb-reveal="">
              <h2>See LingoBridge in action.</h2>
              <p>Watch the extension workflow from selection to translation and review.</p>
            </div>
            <VideoEmbed />
            <a
              className={styles.quietLink}
              href={DEMO_VIDEO_WATCH_URL}
              rel="noreferrer"
              target="_blank"
            >
              Watch on YouTube
              <ArrowRightIcon size={15} />
            </a>
          </div>
        </section>

        {/* 3. Feature breakdown: the workflow */}
        <section aria-label="How LingoBridge works" className={styles.howSection} id="how-it-works">
          <div className={styles.sectionInner}>
            <div className={styles.sectionLead} data-lb-reveal="">
              <h2>Select. Click. Understand.</h2>
              <p>
                LingoBridge stays quiet until you ask for it, then keeps the full translation
                workflow beside the text you are reading.
              </p>
            </div>
            <ol className={styles.workflow} data-lb-stagger="">
              {workflow.map((step, index) => (
                <li className={styles.workflowItem} key={step.title}>
                  <span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span>
                  <h3>{step.title}</h3>
                  <p>{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 4. Feature breakdown: capabilities */}
        <section className={styles.capabilitiesSection}>
          <div className={styles.sectionInner}>
            <div className={styles.sectionLead} data-lb-reveal="">
              <h2>The browser is the workspace.</h2>
              <p>
                Translate in the compact popup or beside selected text without losing your place on
                the page.
              </p>
            </div>

            <div className={styles.capabilityList} data-lb-stagger="">
              <article className={styles.primaryCapability}>
                <h3>Translate in place</h3>
                <p>
                  The result appears next to the sentence you selected, in the same tab, with the
                  original still in view.
                </p>
                <div className={styles.inlineDemo}>
                  <p className={styles.inlineSource} lang="en">
                    Please bring the signed form to your appointment.
                  </p>
                  <span className={styles.inlineMarker}>
                    <ArrowRightIcon size={14} />
                    LingoBridge
                  </span>
                  <p className={styles.inlineOutput} lang="ne">
                    कृपया हस्ताक्षर गरिएको फारम आफ्नो भेटघाटमा ल्याउनुहोस्।
                  </p>
                </div>
              </article>

              <article className={styles.capabilityCard}>
                <span className={styles.capabilityIcon}>
                  <SearchIcon size={18} />
                </span>
                <h3>Multilingual by design</h3>
                <p>
                  Search the active language catalogue, detect a source language, and keep your
                  preferred targets close.
                </p>
                <p aria-hidden="true" className={styles.languageSpecimen}>
                  <span className={styles.specimenSource}>English</span> · नेपाली · 日本語 · العربية
                </p>
              </article>

              <article className={styles.capabilityCard}>
                <span className={styles.capabilityIcon}>
                  <VocabularyIcon size={18} />
                </span>
                <h3>Understand more than a sentence</h3>
                <p>
                  Look up a chosen word in context and save useful vocabulary only when you ask.
                </p>
              </article>

              <article className={styles.capabilityCard}>
                <span className={styles.capabilityIcon}>
                  <PhrasesIcon size={18} />
                </span>
                <h3>A deliberate personal library</h3>
                <p>
                  Search saved phrases, manage connected extensions, export your data, or delete it
                  from one dashboard.
                </p>
              </article>
            </div>
          </div>
        </section>

        {/* 5. Control */}
        <section className={styles.automationSection} id="automation">
          <div className={styles.sectionInner}>
            <div className={styles.sectionLead} data-lb-reveal="">
              <h2>Some work should disappear. Your decisions should not.</h2>
              <p>
                Language detection, target recall, provider routing, and deliberate sync can happen
                quickly. Reading a page, sending text Online, replacing writing, and saving a result
                remain yours to decide.
              </p>
            </div>
            <div className={styles.controlSplit} data-lb-stagger="">
              <section aria-labelledby="handles-title" className={styles.controlCard}>
                <h3 id="handles-title">LingoBridge handles</h3>
                <ul>
                  {handled.map((item) => (
                    <li key={item}>
                      <CheckIcon size={15} />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
              <section
                aria-labelledby="decide-title"
                className={`${styles.controlCard} ${styles.controlCardYou}`}
              >
                <h3 id="decide-title">You decide</h3>
                <ul>
                  {decided.map((item) => (
                    <li key={item}>
                      <PrivacyIcon size={15} />
                      {item}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </section>

        {/* 6. Dashboard + data boundary */}
        <section className={styles.dashboardSection} id="dashboard">
          <div className={styles.sectionInner}>
            <div className={styles.sectionLead} data-lb-reveal="">
              <h2>A home for what you choose to keep.</h2>
              <p>
                Search saved phrases and vocabulary, update safe preferences, review connected
                extensions, export your data, and stay in control of deletion.
              </p>
            </div>

            <div className={styles.dataBoundary} data-lb-reveal="">
              <div className={styles.boundaryIntro}>
                <span className={styles.boundaryEyebrow}>Data boundary</span>
                <h3>Only saved items cross into your account.</h3>
              </div>
              <div className={styles.boundaryGroups} data-lb-stagger="">
                <section className={styles.boundaryGroup}>
                  <div className={styles.boundaryGroupHeading}>
                    <PrivacyIcon size={18} />
                    <div>
                      <h4>Stays on this device</h4>
                      <p>Never added to your dashboard.</p>
                    </div>
                  </div>
                  <ul className={styles.boundaryList}>
                    {deviceOnlyData.map((item) => (
                      <li key={item.label}>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className={`${styles.boundaryGroup} ${styles.boundaryGroupSynced}`}>
                  <div className={styles.boundaryGroupHeading}>
                    <CheckIcon size={18} />
                    <div>
                      <h4>Available in your dashboard</h4>
                      <p>Only after you explicitly save it.</p>
                    </div>
                  </div>
                  <ul className={styles.boundaryList}>
                    {dashboardData.map((item) => (
                      <li key={item.label}>
                        <strong>{item.label}</strong>
                        <span>{item.detail}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              </div>
              <p className={styles.boundaryNote}>
                Unsaved translations, page addresses, and browsing history are never dashboard data.
              </p>
            </div>

            <div className={styles.inlineActions} data-lb-reveal="">
              <Link className={styles.primaryAction} href="/overview">
                Open dashboard
                <ArrowRightIcon size={16} />
              </Link>
              <Link className={styles.secondaryAction} href="/privacy-policy">
                Read the privacy policy
              </Link>
            </div>
          </div>
        </section>

        {/* 7. FAQ */}
        <section className={styles.faqSection} id="faq">
          <div className={styles.sectionInner}>
            <div className={styles.sectionLead} data-lb-reveal="">
              <h2>Questions, plainly answered.</h2>
              <p>No invented language counts, hidden history, or automatic page translation.</p>
            </div>
            <div className={styles.faqList} data-lb-stagger="">
              {faqs.map((item) => (
                <details className={styles.faqItem} key={item.question}>
                  <summary>
                    {item.question}
                    <span aria-hidden="true" className={styles.faqSign} />
                  </summary>
                  <p className={styles.faqAnswer}>{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* 8. Closing CTA */}
        <section className={styles.installSection}>
          <div className={styles.installInner} data-lb-reveal="">
            <p aria-hidden="true" className={styles.installScripts}>
              Translate · अनुवाद · 翻訳 · ترجمة
            </p>
            <h2>Translate with less interruption and more control.</h2>
            <p className={styles.installCopy}>
              Install LingoBridge from its official Chrome Web Store listing.
            </p>
            <StoreLink className={styles.installAction} />
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div className={styles.footerBrand}>
            <Brand href="/" />
            <p className={styles.footerTagline}>Understand the words in front of you.</p>
          </div>
          <div className={styles.footerLinks}>
            <div>
              <strong>Product</strong>
              <a href="#how-it-works">How it works</a>
              <a href="#automation">Control</a>
              <a href="#demo">Demo</a>
              <a href={CHROME_WEB_STORE_URL} rel="noreferrer" target="_blank">
                Chrome Web Store
              </a>
            </div>
            <div>
              <strong>Account</strong>
              <Link href="/overview">Dashboard</Link>
              <Link href="/sign-in">Sign in</Link>
            </div>
            <div>
              <strong>Trust</strong>
              <Link href="/privacy-policy">Privacy policy</Link>
              <a href="#faq">FAQ</a>
            </div>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>LingoBridge</span>
          <span>Built for deliberate translation.</span>
        </div>
      </footer>
    </div>
  );
}
