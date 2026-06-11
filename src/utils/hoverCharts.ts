type ChartTone = "default" | "danger" | "success";

const chartTileSize = "280px 76px";
const chartWidth = 360;
const chartHeight = 96;

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
      if (element.dataset.hoverChartReady === "true") {
        return;
      }

      const tone = getChartTone(element);
      element.dataset.hoverChartReady = "true";
      element.dataset.hoverChartTone = tone;
      element.style.setProperty("--hover-chart-overlay", createChartOverlay(tone));
      element.style.setProperty("--hover-chart-glow", chartGlows[tone]);
      element.style.setProperty("--hover-chart-size", chartTileSize);
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

function createChartOverlay(tone: ChartTone) {
  const candles = createRandomCandles(tone);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${chartWidth} ${chartHeight}" preserveAspectRatio="none">
      ${candles}
    </svg>
  `;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function createRandomCandles(tone: ChartTone) {
  const candleCount = 12;
  const bodyWidth = 10;
  const edgePadding = bodyWidth / 2 + 4;
  const spacing = (chartWidth - edgePadding * 2) / (candleCount - 1);
  const bullishBias = tone === "success" ? 0.72 : tone === "danger" ? 0.28 : 0.5;
  let previousClose = randomBetween(38, 58);

  return Array.from({ length: candleCount }, (_, index) => {
    const centerX = Math.round(edgePadding + spacing * index);
    const open = clamp(previousClose + randomBetween(-11, 11), 18, 78);
    const bullish = Math.random() < bullishBias;
    const shock = Math.random() > 0.76 ? randomBetween(8, 16) : 0;
    const bodyMove = (randomBetween(7, 18) + shock) * (bullish ? -1 : 1);
    const close = clamp(open + bodyMove + randomBetween(-4, 4) + (48 - open) * 0.08, 16, 80);
    const top = Math.min(open, close);
    const bottom = Math.max(open, close);
    const high = Math.max(8, top - randomBetween(5, 14));
    const low = Math.min(88, bottom + randomBetween(5, 14));
    const bodyTop = Math.min(open, close);
    const bodyHeight = Math.max(5, Math.abs(open - close));
    const color = close < open ? candleColors.bullish : candleColors.bearish;

    previousClose = close + randomBetween(-5, 5);

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
