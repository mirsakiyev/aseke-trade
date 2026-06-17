type ChartTone = "default" | "danger" | "success";

interface ChartProfile {
  width: number;
  height: number;
  volatility: number;
  fillsElement: boolean;
}

const compactChartProfile = {
  width: 280,
  height: 76,
  volatility: 1,
  fillsElement: false
} satisfies ChartProfile;

const hoverTargetSelector = [
  ".feature-card",
  ".content-card",
  ".pricing-card",
  ".section-panel",
  ".module-card",
  ".access-panel",
  ".quiz-option",
  ".quiz-recommendation-card",
  ".chart-card",
  ".charts-learning-cta",
  ".risk-band",
  ".course-hero > div",
  ".primary-button",
  ".ghost-button",
  ".platinum-button",
  ".icon-button.danger",
  ".hover-chart-trigger",
  ".filter-pill",
  ".danger-text"
].join(",");

const dangerText = /\b(cancel|decline|delete|remove|revoke|go back|back to|back)\b/i;
const successText = /\b(proceed|continue|complete|confirm|approve|grant|save|submit|success|done)\b/i;

const chartGlows = {
  default: "rgba(142, 202, 224, 0.2)",
  danger: "rgba(255, 107, 107, 0.2)",
  success: "rgba(126, 224, 167, 0.2)"
} satisfies Record<ChartTone, string>;

const candleColors = {
  bullish: "#7ee0a7",
  bearish: "#ff6b6b"
};

export function applyRandomHoverCharts() {
  const assignCharts = () => {
    document.querySelectorAll<HTMLElement>(hoverTargetSelector).forEach((element) => {
      if (element.closest(".no-hover-effect")) {
        element.dataset.hoverChartReady = "false";
        element.style.removeProperty("--hover-chart-overlay");
        element.style.removeProperty("--hover-chart-glow");
        element.style.removeProperty("--hover-chart-size");
        return;
      }

      const profile = getChartProfile(element);
      const signature = `${Math.round(profile.width)}x${Math.round(profile.height)}:${profile.volatility}`;

      if (element.dataset.hoverChartReady === "true" && element.dataset.hoverChartSignature === signature) {
        return;
      }

      const tone = getChartTone(element);
      element.dataset.hoverChartReady = "true";
      element.dataset.hoverChartSignature = signature;
      element.dataset.hoverChartTone = tone;
      element.style.setProperty("--hover-chart-overlay", createChartOverlay(tone, profile));
      element.style.setProperty("--hover-chart-glow", chartGlows[tone]);
      element.style.setProperty(
        "--hover-chart-size",
        profile.fillsElement ? "100% 100%" : `${Math.round(profile.width)}px ${Math.round(profile.height)}px`
      );
    });
  };

  assignCharts();
  const frame = window.requestAnimationFrame(assignCharts);
  const timer = window.setTimeout(assignCharts, 650);
  const observer = new MutationObserver(assignCharts);
  window.addEventListener("resize", assignCharts);

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    window.removeEventListener("resize", assignCharts);
    observer.disconnect();
  };
}

function getChartTone(element: HTMLElement): ChartTone {
  const text = element.textContent?.trim() ?? "";
  const isAction = element.matches(".primary-button, .ghost-button, .platinum-button, .icon-button, button, a");

  if (element.matches(".danger, .danger-text, [aria-label*='delete' i]") || (isAction && dangerText.test(text))) {
    return "danger";
  }

  if (element.matches(".form-success") || (isAction && successText.test(text))) {
    return "success";
  }

  return "default";
}

function getChartProfile(element: HTMLElement): ChartProfile {
  const isSurface = element.matches(
    ".feature-card, .content-card, .pricing-card, .section-panel, .module-card, .access-panel, .chart-card, .charts-learning-cta, .risk-band, .course-hero > div, .quiz-option, .quiz-recommendation-card"
  );

  if (!isSurface) {
    return compactChartProfile;
  }

  const width = clamp(Math.round(element.offsetWidth || compactChartProfile.width), compactChartProfile.width, 1600);
  const height = clamp(Math.round(element.offsetHeight || compactChartProfile.height), compactChartProfile.height, 520);
  const heightBoost = (height - compactChartProfile.height) / 120;
  const widthBoost = (width - compactChartProfile.width) / 900;
  const volatility = clamp(1.1 + heightBoost + widthBoost, 1, 3.4);

  return { width, height, volatility, fillsElement: true };
}

function createChartOverlay(tone: ChartTone, profile: ChartProfile) {
  const candles = createRandomCandles(tone, profile);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${profile.width} ${profile.height}" preserveAspectRatio="xMidYMid meet">
      ${candles}
    </svg>
  `;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function createRandomCandles(tone: ChartTone, profile: ChartProfile) {
  const bodyWidth = 10;
  const edgePadding = bodyWidth / 2 + 4;
  const candleCount = clamp(Math.round(profile.width / 16), 16, 96);
  const spacing = (profile.width - edgePadding * 2) / (candleCount - 1);
  const bullishBias = tone === "success" ? 0.72 : tone === "danger" ? 0.28 : 0.5;
  const centerY = profile.height / 2;
  const topLimit = Math.max(7, profile.height * 0.05);
  const bottomLimit = Math.min(profile.height - 7, profile.height * 0.95);
  const waveAmplitude = clamp(profile.height * (0.18 + profile.volatility * 0.08), profile.height * 0.22, profile.height * 0.42);
  const secondaryAmplitude = clamp(profile.height * 0.06 * profile.volatility, 4, profile.height * 0.14);
  const primaryPhase = randomBetween(0, Math.PI * 2);
  const secondaryPhase = randomBetween(0, Math.PI * 2);
  const moveMin = 5.5 * profile.volatility;
  const moveMax = 11.5 * profile.volatility;
  const wickMin = 4.5 * profile.volatility;
  const wickMax = 10 * profile.volatility;
  let previousClose = clamp(centerY + Math.sin(primaryPhase) * waveAmplitude * 0.35, topLimit, bottomLimit);

  return Array.from({ length: candleCount }, (_, index) => {
    const centerX = Math.round(edgePadding + spacing * index);
    const progress = index / Math.max(1, candleCount - 1);
    const targetY = clamp(
      centerY +
        Math.sin(progress * Math.PI * 3.4 + primaryPhase) * waveAmplitude +
        Math.sin(progress * Math.PI * 8.2 + secondaryPhase) * secondaryAmplitude,
      topLimit,
      bottomLimit
    );
    const open = clamp(
      previousClose + (targetY - previousClose) * 0.36 + randomBetween(-4.5, 4.5) * profile.volatility,
      topLimit,
      bottomLimit
    );
    const bullish = Math.random() < bullishBias;
    const shock = Math.random() > 0.82 ? randomBetween(4, 8) * profile.volatility : 0;
    const bodyMove = (randomBetween(moveMin, moveMax) + shock) * (bullish ? -1 : 1);
    const close = clamp(
      open + bodyMove + (targetY - open) * 0.2 + randomBetween(-2.5, 2.5) * profile.volatility,
      topLimit,
      bottomLimit
    );
    const top = Math.min(open, close);
    const bottom = Math.max(open, close);
    const high = Math.max(4, top - randomBetween(wickMin, wickMax));
    const low = Math.min(profile.height - 4, bottom + randomBetween(wickMin, wickMax));
    const bodyTop = Math.min(open, close);
    const bodyHeight = Math.max(5, Math.abs(open - close));
    const color = close < open ? candleColors.bullish : candleColors.bearish;

    previousClose = close + randomBetween(-5, 5) * profile.volatility;

    return `
      <line x1="${centerX}" y1="${Math.round(high)}" x2="${centerX}" y2="${Math.round(low)}" stroke="${color}" stroke-opacity=".36" stroke-width="2" stroke-linecap="round"/>
      <rect x="${Math.round(centerX - bodyWidth / 2)}" y="${Math.round(bodyTop)}" width="${bodyWidth}" height="${Math.round(bodyHeight)}" rx="2" fill="${color}" fill-opacity=".1" stroke="${color}" stroke-opacity=".48" stroke-width="1.8"/>
    `;
  }).join("");
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
