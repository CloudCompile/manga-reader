// Shared content for the legal pages (/terms, /privacy, /disclaimer).
//
// The site is public and promoted, so the text is written to be honest about
// what it does rather than to bury it: it says plainly that the reader indexes
// third-party sites, that it does not host the images, and that it disclaims
// what it can. It is not legal advice and is not a substitute for review by a
// lawyer.

export interface LegalSection {
  heading: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface LegalDoc {
  slug: string;
  title: string;
  updated: string;
  summary: string;
  sections: LegalSection[];
}

// Bump when the text changes materially; shown as "Last updated" on each page.
export const LEGAL_UPDATED = "18 October 2026";

// Where takedown requests and questions go. One place, so it is easy to keep
// consistent across the three documents. This must be a mailbox someone
// actually reads: a notice sent to an address that bounces is worse than no
// address at all, because it cannot be acted on.
export const LEGAL_CONTACT = "christopher.j.hauser2025@outlook.com";

export const TERMS: LegalDoc = {
  slug: "terms",
  title: "Terms of Use",
  updated: LEGAL_UPDATED,
  summary:
    "The ground rules for using this reader. In short: it is a personal tool provided as-is, it indexes third-party sites rather than hosting manga, and you are responsible for how you use it.",
  sections: [
    {
      heading: "1. What this service is",
      paragraphs: [
        "This site is a reader interface. It lets you enter or pick a chapter on a third-party website and view the images that site serves, in a cleaner layout.",
        "This service does not host, upload, store, or own any manga. The images are loaded by your own browser directly from the third-party site that publishes them, so the request never passes through this service. This service is not affiliated with, endorsed by, or sponsored by any of those sites or by any publisher, licensor, or rights holder.",
      ],
    },
    {
      heading: "2. Your responsibility",
      paragraphs: [
        "You are responsible for the material you access and for complying with the laws that apply to you, and with the terms of any site you reach through this reader.",
        "You should only use this reader for material you are legally entitled to access, such as material you have licensed, material that is in the public domain, or material the rights holder has made available.",
      ],
    },
    {
      heading: "3. Acceptable use",
      bullets: [
        "Do not use this service to infringe anyone's rights.",
        "Do not attempt to disrupt, overload, or gain unauthorised access to the service or to any third-party site through it.",
        "Do not scrape or redistribute the service itself in a way that breaks these terms.",
        "Do not use the service if you are below the age at which you may lawfully view the material you are accessing in your jurisdiction.",
      ],
    },
    {
      heading: "4. No warranty",
      paragraphs: [
        'The service is provided "as is" and "as available", without warranties of any kind, express or implied, including any warranty of merchantability, fitness for a particular purpose, or non-infringement.',
        "Third-party sites change without notice. Chapters, images, and search results may be missing, broken, out of date, or unavailable at any time, and the service may be changed or shut down without notice.",
      ],
    },
    {
      heading: "5. Limitation of liability",
      paragraphs: [
        "To the maximum extent permitted by law, the operator of this service is not liable for any indirect, incidental, special, consequential, or exemplary damages, or for any loss of data, revenue, or goodwill, arising from your use of the service or from any content reached through it.",
        "Nothing in these terms excludes or limits any liability that cannot be excluded or limited under applicable law.",
      ],
    },
    {
      heading: "6. Copyright and takedown",
      paragraphs: [
        "This service does not host the material that is displayed. Images are loaded by your browser directly from the third-party site that serves them, so the correct first step for a removal request is to contact that site.",
        "That said, if a listing, link, or piece of metadata in this service points at material that infringes your rights, send a notice to the contact address below and it will be reviewed and, where appropriate, removed promptly.",
        `Contact: ${LEGAL_CONTACT}`,
      ],
    },
    {
      heading: "7. Changes",
      paragraphs: [
        "These terms may change at any time. Continuing to use the service after a change means you accept the updated terms. The date at the top of this page shows when it last changed.",
      ],
    },
  ],
};

export const PRIVACY: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  updated: LEGAL_UPDATED,
  summary:
    "What this service stores and where. In short: your reading state stays on your own device in a cookie, and the server keeps no accounts, no profiles, and no analytics.",
  sections: [
    {
      heading: "1. The short version",
      bullets: [
        "No account is required, and none exists.",
        "No analytics, advertising, or tracking scripts are used.",
        "Your reading state is stored on your own device, in cookies, not on a server.",
        "The server processes requests to fetch pages and images on your behalf, and keeps a short-lived cache of images so repeated reads are fast.",
      ],
    },
    {
      heading: "2. What is stored on your device",
      paragraphs: [
        "The reader keeps its state in first-party cookies set by this site. They contain only reader preferences and reading state, for example your theme choice, fit mode, reading history, reading list, and which chapter you last reached.",
        "These cookies are marked Secure and SameSite=Lax. They are not shared with any third party, and they are not used to build a profile. Clearing your browser data removes them.",
        "Browsers that block cookies still work: the reader falls back to in-memory state for the current session instead of failing.",
      ],
    },
    {
      heading: "3. What the server processes",
      paragraphs: [
        "When you open a chapter, the server fetches the chapter page on your behalf so your browser does not have to make that cross-origin request. Page images are loaded by your browser directly from the publishing host, so image requests do not reach this server. That request includes the target address you asked for, and your IP address is visible to the server as it is for any website you visit.",
        "If a publishing host ever blocks direct loading, the reader retries that image through the service's own proxy route, which fetches it server-side and forwards it. Fetched images are held in a short-lived in-memory cache (about 30 minutes) so that re-reading a chapter does not refetch every page. The cache is not tied to any user and is discarded when the process restarts.",
        "Rate limiting counts requests per IP address in memory, for a one-minute window, purely to keep the service responsive. These counters are not logged and are not retained.",
      ],
    },
    {
      heading: "4. What is not collected",
      bullets: [
        "No names, email addresses, or account credentials.",
        "No advertising identifiers, and no advertising.",
        "No third-party analytics, heatmaps, or session recording.",
        "No sale or sharing of personal data, because none is collected.",
      ],
    },
    {
      heading: "5. Third parties",
      paragraphs: [
        "When the service loads a chapter, your browser requests the page images directly from the third-party site that hosts them, and the server requests the chapter page itself. Those sites see those requests and have their own privacy practices, which this service does not control and which you should review.",
        "Title information is enriched using the public MangaDex API to power alternate-title search. Only the title text being looked up is sent.",
      ],
    },
    {
      heading: "6. Your choices",
      paragraphs: [
        "You can clear the reader's cookies at any time through your browser settings, which resets all saved preferences and reading state.",
        "If you have a privacy question or a request about data, contact the address below.",
        `Contact: ${LEGAL_CONTACT}`,
      ],
    },
  ],
};

export const DISCLAIMER: LegalDoc = {
  slug: "disclaimer",
  title: "Disclaimer",
  updated: LEGAL_UPDATED,
  summary:
    "A plain statement of what this service is and is not, so there is no confusion about hosting, ownership, or affiliation.",
  sections: [
    {
      heading: "Not affiliated with any publisher or site",
      paragraphs: [
        "This is an independent, unofficial reader. It is not affiliated with, authorised by, endorsed by, or sponsored by any manga publisher, licensor, scanlation group, or third-party site it can index. All titles, trademarks, and images belong to their respective owners.",
      ],
    },
    {
      heading: "Does not host content",
      paragraphs: [
        "This service does not host, store, upload, or distribute manga. It reads pages that are already published on third-party websites, and your browser loads the images directly from the site that publishes them. No images are stored on this service.",
      ],
    },
    {
      heading: "Provided as-is",
      paragraphs: [
        'The service is offered "as is", without warranty of any kind. It may be unavailable, incomplete, or wrong, and it may change or stop at any time.',
      ],
    },
    {
      heading: "Use at your own discretion",
      paragraphs: [
        "You are responsible for what you access and for complying with the law where you live. If you enjoy a series, the best way to support it is to buy it from an official publisher or read it on a licensed service.",
      ],
    },
    {
      heading: "Copyright concerns",
      paragraphs: [
        "Because this service does not host the material, removal requests are best directed to the site serving it. If a link or listing here is the problem, contact the address below and it will be reviewed and, where appropriate, removed promptly.",
        `Contact: ${LEGAL_CONTACT}`,
      ],
    },
  ],
};

export const LEGAL_DOCS: LegalDoc[] = [TERMS, PRIVACY, DISCLAIMER];

export function legalDoc(slug: string): LegalDoc | undefined {
  return LEGAL_DOCS.find((d) => d.slug === slug);
}
