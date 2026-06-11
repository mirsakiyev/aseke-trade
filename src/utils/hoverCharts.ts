type ChartTone = "default" | "danger" | "success";
type ChartDensity = "normal" | "large";

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
  ".filter-pill",
  ".danger-text"
].join(",");

const dangerText = /\b(cancel|decline|delete|remove|revoke|go back|back to|back)\b/i;
const successText = /\b(proceed|continue|complete|confirm|approve|grant|save|submit|success|done)\b/i;

const chartGlows = {
  default: "rgba(229, 228, 226, 0.18)",
  danger: "rgba(255, 107, 107, 0.22)",
  success: "rgba(126, 224, 167, 0.22)"
} satisfies Record<ChartTone, string>;

const candleColors = {
  bullish: "#7ee0a7",
  bearish: "#ff6b6b"
};

export function applyRandomHoverCharts() {
  const assignCharts = () => {
    document.querySelectorAll<HTMLElement>(hoverTargetSelector).forEach((element) => {
      const density = getChartDensity(element);

      if (element.dataset.hoverChartReady === "true" && element.dataset.hoverChartDensity === density) {
        return;
      }

      const tone = getChartTone(element);
      element.dataset.hoverChartReady = "true";
      element.dataset.hoverChartTone = tone;
      element.dataset.hoverChartDensity = density;
      element.style.setProperty("--hover-chart-overlay", createChartOverlay(tone, density));
      element.style.setProperty("--hover-chart-glow", chartGlows[tone]);
      element.style.setProperty("--hover-chart-size", density === "large" ? "560px 100%" : "360px 128px");
    });
  };

  assignCharts();
  const frame = window.requestAnimationFrame(assignCharts);
  const timer = window.setTimeout(assignCharts, 650);
  const observer = new MutationObserver(assignCharts);

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  return () => {
    window.cancelAnimationFrame(frame);
    window.clearTimeout(timer);
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

function getChartDensity(element: HTMLElement): ChartDensity {
  const largePanelClasses = [
    "level-panel",
    "payment-instructions-panel",
    "payment-action-panel",
    "checkout-method-panel",
    "checkout-summary-panel",
    "guide-quiz-panel",
    "puzzle-panel",
    "terms-panel",
    "admin-payment-card",
    "payment-history-card"
  ];
  const isPanelSurface = element.matches(
    ".section-panel, .chart-card, .charts-learning-cta, .risk-band, .course-hero > div"
  );
  const hasLargeClass = largePanelClasses.some((className) => element.classList.contains(className));
  const isTallSurface = element.offsetHeight >= 260;
  const isWideTallSurface = element.offsetWidth >= 500 && element.offsetHeight >= 210;

  return isPanelSurface && (hasLargeClass || isTallSurface || isWideTallSurface) ? "large" : "normal";
}

function createChartOverlay(tone: ChartTone, density: ChartDensity) {
  const candles = createRandomCandles(tone, density);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 180" preserveAspectRatio="none">
      ${candles}
    </svg>
  `;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function createRandomCandles(tone: ChartTone, density: ChartDensity) {
  const isLarge = density === "large";
  const candleCount = isLarge ? 20 : 16;
  const bodyWidth = isLarge ? 14 : 16;
  const edgePadding = bodyWidth / 2 + 4;
  const spacing = (420 - edgePadding * 2) / (candleCount - 1);
  const bullishBias = tone === "success" ? 0.72 : tone === "danger" ? 0.28 : 0.5;
  let previousClose = randomBetween(isLarge ? 40 : 74, isLarge ? 140 : 106);

  return Array.from({ length: candleCount }, (_, index) => {
    const centerX = Math.round(edgePadding + spacing * index);
    const open = clamp(
      previousClose + randomBetween(isLarge ? -30 : -15, isLarge ? 30 : 15),
      isLarge ? 18 : 48,
      isLarge ? 162 : 132
    );
    const bullish = Math.random() < bullishBias;
    const shock = Math.random() > (isLarge ? 0.58 : 0.78) ? randomBetween(isLarge ? 22 : 10, isLarge ? 48 : 22) : 0;
    const bodyMove = (randomBetween(isLarge ? 18 : 11, isLarge ? 50 : 30) + shock) * (bullish ? -1 : 1);
    const close = clamp(
      open + bodyMove + randomBetween(isLarge ? -16 : -8, isLarge ? 16 : 8) + (90 - open) * (isLarge ? 0.035 : 0.1),
      isLarge ? 18 : 46,
      isLarge ? 162 : 134
    );
    const top = Math.min(open, close);
    const bottom = Math.max(open, close);
    const high = Math.max(isLarge ? 4 : 24, top - randomBetween(isLarge ? 14 : 8, isLarge ? 42 : 24));
    const low = Math.min(isLarge ? 176 : 156, bottom + randomBetween(isLarge ? 14 : 8, isLarge ? 42 : 24));
    const bodyTop = Math.min(open, close);
    const bodyHeight = Math.max(isLarge ? 10 : 7, Math.abs(open - close));
    const color = close < open ? candleColors.bullish : candleColors.bearish;

    previousClose = close + randomBetween(isLarge ? -14 : -5, isLarge ? 14 : 5);

    return `
      <line x1="${centerX}" y1="${Math.round(high)}" x2="${centerX}" y2="${Math.round(low)}" stroke="${color}" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/>
      <rect x="${Math.round(centerX - bodyWidth / 2)}" y="${Math.round(bodyTop)}" width="${bodyWidth}" height="${Math.round(bodyHeight)}" rx="2" fill="${color}" fill-opacity=".14" stroke="${color}" stroke-opacity=".64" stroke-width="1.8"/>
    `;
  }).join("");
}

function randomBetween(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
