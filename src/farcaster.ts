// Farcaster Mini-App manifest (`/.well-known/farcaster.json`), `<meta name="fc:miniapp">` tags,
// and crisp zero-cost inline SVG branding assets (`/icon.svg`, `/og.svg`).

import { escapeHtmlAttr } from "./security.ts";

export interface FarcasterManifest {
  accountAssociation: {
    header: string;
    payload: string;
    signature: string;
  };
  miniapp: {
    version: "1";
    name: string;
    homeUrl: string;
    iconUrl: string;
    imageUrl: string;
    splashImageUrl: string;
    splashBackgroundColor: string;
    buttonTitle: string;
    subtitle: string;
    description: string;
    primaryCategory: string;
    tags: string[];
  };
  frame: {
    version: "1";
    name: string;
    homeUrl: string;
    iconUrl: string;
    imageUrl: string;
    splashImageUrl: string;
    splashBackgroundColor: string;
    buttonTitle: string;
  };
}

export function buildFarcasterManifest(origin: string, env: Env): FarcasterManifest {
  const header =
    env.FARCASTER_HEADER?.trim() ||
    "<OWNER_ACTION_REQUIRED: paste Farcaster accountAssociation.header after signing deployed domain>";
  const payload =
    env.FARCASTER_PAYLOAD?.trim() ||
    "<OWNER_ACTION_REQUIRED: paste Farcaster accountAssociation.payload for deployed domain>";
  const signature =
    env.FARCASTER_SIGNATURE?.trim() ||
    "<OWNER_ACTION_REQUIRED: paste Farcaster custody accountAssociation.signature>";

  const iconUrl = `${origin}/icon.svg`;
  const imageUrl = `${origin}/og.svg`;

  return {
    accountAssociation: {
      header,
      payload,
      signature,
    },
    miniapp: {
      version: "1",
      name: "Upswing SolSignal",
      homeUrl: origin,
      iconUrl,
      imageUrl,
      splashImageUrl: iconUrl,
      splashBackgroundColor: "#070B14",
      buttonTitle: "Scan Solana Token",
      subtitle: "Solana Token Safety & x402 Signal API",
      description:
        "Real-time Solana SPL rug-risk scanner, liquidity microstructure analytics, and x402 USDC AI agent signal API.",
      primaryCategory: "finance",
      tags: ["solana", "defi", "security", "x402", "signals"],
    },
    frame: {
      version: "1",
      name: "Upswing SolSignal",
      homeUrl: origin,
      iconUrl,
      imageUrl,
      splashImageUrl: iconUrl,
      splashBackgroundColor: "#070B14",
      buttonTitle: "Scan Solana Token",
    },
  };
}

export function buildFarcasterMetaTags(origin: string): string {
  const miniappEmbed = JSON.stringify({
    version: "1",
    imageUrl: `${origin}/og.svg`,
    button: {
      title: "Scan Solana Token",
      action: {
        type: "launch_miniapp",
        name: "Upswing SolSignal",
        url: origin,
        splashImageUrl: `${origin}/icon.svg`,
        splashBackgroundColor: "#070B14",
      },
    },
  });

  const frameEmbed = JSON.stringify({
    version: "1",
    imageUrl: `${origin}/og.svg`,
    button: {
      title: "Scan Solana Token",
      action: {
        type: "launch_frame",
        name: "Upswing SolSignal",
        url: origin,
        splashImageUrl: `${origin}/icon.svg`,
        splashBackgroundColor: "#070B14",
      },
    },
  });

  return [
    `<meta name="fc:miniapp" content="${escapeHtmlAttr(miniappEmbed)}" />`,
    `<meta name="fc:frame" content="${escapeHtmlAttr(frameEmbed)}" />`,
  ].join("\n    ");
}

export function renderIconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B1221" />
      <stop offset="100%" stop-color="#050810" />
    </linearGradient>
    <linearGradient id="sig" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#14F195" />
      <stop offset="55%" stop-color="#00D1FF" />
      <stop offset="100%" stop-color="#9945FF" />
    </linearGradient>
  </defs>
  <rect width="256" height="256" rx="56" fill="url(#bg)" />
  <rect x="12" y="12" width="232" height="232" rx="46" fill="none" stroke="url(#sig)" stroke-width="4" opacity="0.5" />
  <path d="M52 154 L94 154 L112 94 L138 176 L160 116 L176 138 L204 138" fill="none" stroke="url(#sig)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="204" cy="138" r="9" fill="#14F195" />
</svg>`;
}

export function renderOgSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" width="1200" height="800">
  <defs>
    <linearGradient id="ogbg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#070B14" />
      <stop offset="60%" stop-color="#0D1629" />
      <stop offset="100%" stop-color="#07131A" />
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#14F195" />
      <stop offset="50%" stop-color="#00D1FF" />
      <stop offset="100%" stop-color="#9945FF" />
    </linearGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#ogbg)" />
  <rect x="48" y="48" width="1104" height="704" rx="32" fill="#0B1324" stroke="#1F2E4A" stroke-width="2" />
  <path d="M110 250 L195 250 L232 145 L284 300 L330 185 L362 230 L425 230" fill="none" stroke="url(#accent)" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" />
  <text x="110" y="410" fill="#F8FAFC" font-family="system-ui, -apple-system, sans-serif" font-size="68" font-weight="700">Upswing SolSignal</text>
  <text x="110" y="476" fill="#94A3B8" font-family="system-ui, -apple-system, sans-serif" font-size="32">Real-Time Solana Token Safety &amp; Liquidity Microstructure API</text>
  <rect x="110" y="545" width="290" height="62" rx="14" fill="#0F2922" stroke="#14F195" stroke-width="2" />
  <text x="255" y="585" text-anchor="middle" fill="#14F195" font-family="monospace" font-size="24" font-weight="700">x402: 0.005 USDC</text>
  <rect x="424" y="545" width="280" height="62" rx="14" fill="#111C38" stroke="#00D1FF" stroke-width="2" />
  <text x="564" y="585" text-anchor="middle" fill="#00D1FF" font-family="monospace" font-size="24" font-weight="700">MCP JSON-RPC 2.0</text>
  <rect x="728" y="545" width="330" height="62" rx="14" fill="#1D1333" stroke="#9945FF" stroke-width="2" />
  <text x="893" y="585" text-anchor="middle" fill="#C084FC" font-family="monospace" font-size="24" font-weight="700">Farcaster Mini-App</text>
</svg>`;
}
