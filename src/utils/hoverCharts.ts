type ChartTone = "default" | "danger" | "success";

const hoverTargetSelector = [
  ".feature-card",
  ".content-card",
  ".pricing-card",
  ".section-panel",
  ".module-card",
  ".access-panel",
  ".quiz-option",
  ".quiz-recommendation-card",
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
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 420 180" preserveAspectRatio="none">
      ${candles}
    </svg>
  `;

  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function createRandomCandles(tone: ChartTone) {
  const candleCount = 16;
  const spacing = 420 / (candleCount - 1);
  const bodyWidth = 16;
  const bullishBias = tone === "success" ? 0.72 : tone === "danger" ? 0.28 : 0.5;
  let previousClose = randomBetween(74, 106);

  return Array.from({ length: candleCount }, (_, index) => {
    const centerX = Math.round(spacing * index);
    const open = clamp(previousClose + randomBetween(-15, 15), 48, 132);
    const bullish = Math.random() < bullishBias;
    const shock = Math.random() > 0.78 ? randomBetween(10, 22) : 0;
    const bodyMove = (randomBetween(11, 30) + shock) * (bullish ? -1 : 1);
    const close = clamp(open + bodyMove + randomBetween(-8, 8) + (90 - open) * 0.1, 46, 134);
    const high = clamp(Math.min(open, close) - randomBetween(8, 24), 30, 122);
    const low = clamp(Math.max(open, close) + randomBetween(8, 24), 58, 150);
    const bodyTop = Math.min(open, close);
    const bodyHeight = Math.max(7, Math.abs(open - close));
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
