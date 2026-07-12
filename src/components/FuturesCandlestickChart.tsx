import { LineChart, ZoomIn, ZoomOut } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent
} from "react";

export interface FuturesChartCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type FuturesChartOverlayTone =
  | "mark"
  | "entry"
  | "pending"
  | "target"
  | "hit"
  | "danger"
  | "liquidation"
  | "support"
  | "resistance"
  | "invalidation"
  | "neutral";

export interface FuturesChartOverlayLine {
  id?: string;
  label: string;
  price: number;
  tone: FuturesChartOverlayTone;
  side?: "long" | "short";
  color?: string;
  includeInAutoscale?: boolean;
  showPriceMarker?: boolean;
  showPlotLabel?: boolean;
}

export interface FuturesChartOverlayZone {
  id: string;
  label?: string;
  lowPrice: number;
  highPrice: number;
  tone?: Extract<FuturesChartOverlayTone, "entry" | "support" | "resistance" | "neutral">;
  color?: string;
  opacity?: number;
  includeInAutoscale?: boolean;
}

export interface FuturesChartTimeframeOption<TTimeframe extends string = string> {
  value: TTimeframe;
  label: string;
}

export interface FuturesCandlestickChartProps<TTimeframe extends string = string> {
  candles: FuturesChartCandle[];
  currentPrice: number | null;
  timeframe: TTimeframe;
  timeframeOptions: ReadonlyArray<FuturesChartTimeframeOption<TTimeframe>>;
  onTimeframeChange?: (timeframe: TTimeframe) => void;
  overlayLines?: ReadonlyArray<FuturesChartOverlayLine>;
  overlayZones?: ReadonlyArray<FuturesChartOverlayZone>;
  currentPriceLabel?: string;
  ariaLabel?: string;
  isLoading?: boolean;
  error?: string | null;
  loadingLabel?: string;
  loadingDescription?: string;
  emptyLabel?: string;
  emptyDescription?: string;
  errorLabel?: string;
  readOnly?: boolean;
  className?: string;
}

interface OverlayLineLayout {
  line: FuturesChartOverlayLine;
  lineY: number;
  markerY: number;
}

interface RenderedCandle {
  key: string;
  candleX: number;
  centerX: number;
  bodyY: number;
  bodyHeight: number;
  wickY1: number;
  wickY2: number;
  isUp: boolean;
}

const MIN_DEMO_CHART_PRICE_SCALE = 0.16;
const MAX_DEMO_CHART_PRICE_SCALE = 8;
const DEMO_CHART_PRICE_SCALE_DRAG_SENSITIVITY = 150;
const DEMO_CHART_PRICE_SCALE_WHEEL_SENSITIVITY = 420;
const DEMO_CHART_DRAG_ACTIVATION_PX = 4;
const DEMO_CHART_AXIS_SCALE_VERTICAL_BIAS = 1.15;
const DEMO_CHART_BOUNDARY_DRAG_RESISTANCE = 0.22;
const CHART_WIDTH = 1040;
const CHART_HEIGHT = 660;
const CHART_PADDING = { top: 24, right: 118, bottom: 34, left: 22 } as const;

export function FuturesCandlestickChart<TTimeframe extends string>({
  candles,
  currentPrice,
  timeframe,
  timeframeOptions,
  onTimeframeChange,
  overlayLines = [],
  overlayZones = [],
  currentPriceLabel = "Mark",
  ariaLabel = "BTC USDT futures candlestick chart",
  isLoading = false,
  error = null,
  loadingLabel = "Loading chart",
  loadingDescription = "Market candles will appear here when data is available.",
  emptyLabel = "Chart unavailable",
  emptyDescription = "No candle data is available for this timeframe.",
  errorLabel = "Chart data unavailable",
  readOnly = false,
  className = ""
}: FuturesCandlestickChartProps<TTimeframe>) {
  const clipPathId = `futures-chart-plot-${useId().replace(/:/g, "")}`;
  const [visibleCount, setVisibleCount] = useState(defaultVisibleCandles(timeframe));
  const [offset, setOffset] = useState(0);
  const [isRightDragging, setIsRightDragging] = useState(false);
  const [isPriceScaling, setIsPriceScaling] = useState(false);
  const [priceScale, setPriceScale] = useState(1);
  const [pricePan, setPricePan] = useState(0);
  const [dragPreviewX, setDragPreviewX] = useState(0);
  const [crosshair, setCrosshair] = useState<{ x: number; y: number; price: number } | null>(null);
  const dragStartRef = useRef<{ x: number; y: number; offset: number; pricePan: number; pointerId: number } | null>(null);
  const priceScaleStartRef = useRef<{
    x: number;
    y: number;
    scale: number;
    offset: number;
    pricePan: number;
    pointerId: number;
    isActive: boolean;
  } | null>(null);
  const wheelPanRemainderRef = useRef(0);

  const maxOffset = Math.max(0, candles.length - visibleCount);
  const futurePaddingCandles = Math.min(90, Math.max(24, Math.floor(visibleCount * 0.5)));
  const safeOffset = clamp(offset, -futurePaddingCandles, maxOffset);
  const visibleCandles = useMemo(() => {
    const futureSlots = Math.max(0, -safeOffset);
    const dataWindowCount = Math.max(1, visibleCount - futureSlots);
    const end = Math.max(0, candles.length - Math.max(safeOffset, 0));
    return candles.slice(Math.max(0, end - dataWindowCount), end);
  }, [candles, safeOffset, visibleCount]);

  const resolvedOverlayLines = useMemo(() => {
    const validLines = overlayLines.filter(isValidOverlayLine);
    if (!isPositiveFinite(currentPrice)) return validLines;
    return [
      { id: "current-price", label: currentPriceLabel, price: currentPrice, tone: "mark" as const },
      ...validLines
    ];
  }, [currentPrice, currentPriceLabel, overlayLines]);

  const resolvedOverlayZones = useMemo(
    () => overlayZones.filter(isValidOverlayZone),
    [overlayZones]
  );

  const priceGeometry = useMemo(() => {
    const overlayPrices = resolvedOverlayLines
      .filter((line) => line.includeInAutoscale ?? line.tone !== "liquidation")
      .map((line) => line.price);
    const zonePrices = resolvedOverlayZones
      .filter((zone) => zone.includeInAutoscale !== false)
      .flatMap((zone) => [zone.lowPrice, zone.highPrice]);
    const prices = visibleCandles
      .flatMap((candle) => [candle.high, candle.low])
      .concat(overlayPrices, zonePrices);
    const minPrice = prices.length ? Math.min(...prices) : 0;
    const maxPrice = prices.length ? Math.max(...prices) : 1;
    const range = Math.max(maxPrice - minPrice, 1);
    const basePriceMidpoint = (minPrice + maxPrice) / 2;
    const scaledRange = range * priceScale;
    const visiblePriceRange = scaledRange * 1.24;
    const priceMidpoint = basePriceMidpoint + pricePan;
    return {
      paddedMin: priceMidpoint - visiblePriceRange / 2,
      paddedMax: priceMidpoint + visiblePriceRange / 2,
      visiblePriceRange
    };
  }, [pricePan, priceScale, resolvedOverlayLines, resolvedOverlayZones, visibleCandles]);

  const width = CHART_WIDTH;
  const height = CHART_HEIGHT;
  const padding = CHART_PADDING;
  const axisX = width - padding.right;
  const chartWidth = axisX - padding.left;
  const chartHeight = height - padding.top - padding.bottom;
  const candleGap = chartWidth / Math.max(visibleCount, 1);
  const candleWidth = snapCandleBodyWidth(clamp(candleGap * 0.76, 7, 20));
  const isFastTimeframe = timeframe === "1m" || timeframe === "5m";
  const minBodyHeight = isFastTimeframe ? 5 : 3;
  const minWickHeight = isFastTimeframe ? 12 : 5;
  const { paddedMin, paddedMax, visiblePriceRange } = priceGeometry;
  const yForPrice = (price: number) => padding.top + ((paddedMax - price) / (paddedMax - paddedMin)) * chartHeight;
  const priceForY = (y: number) => paddedMax - ((y - padding.top) / chartHeight) * (paddedMax - paddedMin);

  const priceTicks = useMemo(
    () => Array.from({ length: 8 }, (_, index) => paddedMax - ((paddedMax - paddedMin) / 7) * index),
    [paddedMax, paddedMin]
  );
  const verticalGridCount = Math.min(10, Math.max(4, Math.floor(visibleCount / 10)));
  const verticalGridLines = useMemo(
    () => Array.from({ length: verticalGridCount + 1 }, (_, index) => padding.left + (chartWidth / verticalGridCount) * index),
    [chartWidth, padding.left, verticalGridCount]
  );
  const overlayLineLayouts = useMemo(
    () => resolveOverlayMarkerLayouts(
      resolvedOverlayLines.map((line) => {
        const lineY = clamp(
          padding.top + ((paddedMax - line.price) / (paddedMax - paddedMin)) * chartHeight,
          padding.top + 10,
          height - padding.bottom - 10
        );
        return { line, lineY, markerY: lineY };
      }),
      padding.top + 16,
      height - padding.bottom - 16
    ),
    [chartHeight, height, paddedMax, paddedMin, padding.bottom, padding.top, resolvedOverlayLines]
  );
  const renderedZones = useMemo(
    () => resolvedOverlayZones.map((zone) => {
      const highY = padding.top + ((paddedMax - Math.max(zone.lowPrice, zone.highPrice)) / (paddedMax - paddedMin)) * chartHeight;
      const lowY = padding.top + ((paddedMax - Math.min(zone.lowPrice, zone.highPrice)) / (paddedMax - paddedMin)) * chartHeight;
      return {
        zone,
        y: Math.min(highY, lowY),
        height: Math.max(1, Math.abs(lowY - highY))
      };
    }),
    [chartHeight, paddedMax, paddedMin, padding.top, resolvedOverlayZones]
  );
  const renderedCandles = useMemo<RenderedCandle[]>(() => visibleCandles.map((candle, index) => {
    const candleX = snapSvgCoordinate(padding.left + index * candleGap + (candleGap - candleWidth) / 2);
    const openY = padding.top + ((paddedMax - candle.open) / (paddedMax - paddedMin)) * chartHeight;
    const closeY = padding.top + ((paddedMax - candle.close) / (paddedMax - paddedMin)) * chartHeight;
    const highY = padding.top + ((paddedMax - candle.high) / (paddedMax - paddedMin)) * chartHeight;
    const lowY = padding.top + ((paddedMax - candle.low) / (paddedMax - paddedMin)) * chartHeight;
    const previousClose = visibleCandles[index - 1]?.close ?? candle.open;
    const shape = buildCandleShape({ openY, closeY, highY, lowY, minBodyHeight, minWickHeight });
    return {
      key: `${candle.timestamp}-${index}`,
      candleX,
      centerX: candleX + candleWidth / 2,
      bodyY: shape.bodyY,
      bodyHeight: shape.bodyHeight,
      wickY1: shape.wickY1,
      wickY2: shape.wickY2,
      isUp: isBullishCandle(candle, previousClose)
    };
  }), [
    candleGap,
    candleWidth,
    chartHeight,
    minBodyHeight,
    minWickHeight,
    paddedMax,
    paddedMin,
    padding.left,
    padding.top,
    visibleCandles
  ]);

  useEffect(() => {
    setVisibleCount(defaultVisibleCandles(timeframe));
    setOffset(0);
    setPriceScale(1);
    setPricePan(0);
    setDragPreviewX(0);
    wheelPanRemainderRef.current = 0;
    dragStartRef.current = null;
    priceScaleStartRef.current = null;
  }, [timeframe]);

  useEffect(() => {
    setOffset((value) => clamp(value, -futurePaddingCandles, Math.max(0, candles.length - visibleCount)));
  }, [candles.length, futurePaddingCandles, visibleCount]);

  const zoomBy = (amount: number) => {
    setVisibleCount((count) => clamp(count + amount, 28, Math.min(160, Math.max(candles.length, 40))));
  };

  const resetPriceView = () => {
    setPriceScale(1);
    setPricePan(0);
    setCrosshair(null);
  };

  const startRightDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0 && event.button !== 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setCrosshair(null);
    setDragPreviewX(0);
    const pointer = getSvgPointer(event, width, height);
    if (pointer.x >= axisX) {
      priceScaleStartRef.current = {
        x: event.clientX,
        y: event.clientY,
        scale: priceScale,
        offset: safeOffset,
        pricePan,
        pointerId: event.pointerId,
        isActive: false
      };
      setIsRightDragging(false);
      setIsPriceScaling(false);
      return;
    }
    dragStartRef.current = { x: event.clientX, y: event.clientY, offset: safeOffset, pricePan, pointerId: event.pointerId };
    setIsRightDragging(true);
  };

  const updateCrosshair = (event: PointerEvent<SVGSVGElement>) => {
    if (dragStartRef.current || priceScaleStartRef.current) return;
    const pointer = getSvgPointer(event, width, height);
    const x = clamp(pointer.x, padding.left, axisX);
    const y = clamp(pointer.y, padding.top, height - padding.bottom);
    const isInsidePlot = pointer.x >= padding.left
      && pointer.x <= axisX
      && pointer.y >= padding.top
      && pointer.y <= height - padding.bottom;
    setCrosshair(isInsidePlot ? { x, y, price: priceForY(y) } : null);
  };

  const moveRightDrag = (event: PointerEvent<SVGSVGElement>) => {
    if (event.pointerType === "mouse" && event.buttons === 0) {
      stopRightDrag(event);
      return;
    }

    if (priceScaleStartRef.current) {
      event.preventDefault();
      const scaleStart = priceScaleStartRef.current;
      const deltaX = event.clientX - scaleStart.x;
      const deltaY = event.clientY - scaleStart.y;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);
      if (!scaleStart.isActive) {
        if (Math.hypot(deltaX, deltaY) < DEMO_CHART_DRAG_ACTIVATION_PX) return;
        if (absDeltaX > absDeltaY * DEMO_CHART_AXIS_SCALE_VERTICAL_BIAS) {
          dragStartRef.current = {
            x: scaleStart.x,
            y: scaleStart.y,
            offset: scaleStart.offset,
            pricePan: scaleStart.pricePan,
            pointerId: scaleStart.pointerId
          };
          priceScaleStartRef.current = null;
          setIsRightDragging(true);
        } else {
          scaleStart.isActive = true;
          setIsPriceScaling(true);
        }
      }

      if (priceScaleStartRef.current) {
        setCrosshair(null);
        const activeScaleStart = priceScaleStartRef.current;
        const activeDeltaY = event.clientY - activeScaleStart.y;
        setPriceScale(clamp(
          activeScaleStart.scale * Math.exp(activeDeltaY / DEMO_CHART_PRICE_SCALE_DRAG_SENSITIVITY),
          MIN_DEMO_CHART_PRICE_SCALE,
          MAX_DEMO_CHART_PRICE_SCALE
        ));
        return;
      }
    }

    if (!dragStartRef.current) return;
    event.preventDefault();
    setCrosshair(null);
    const rawDeltaX = event.clientX - dragStartRef.current.x;
    const deltaCandles = Math.round(rawDeltaX / Math.max(5, candleGap));
    const nextOffset = clamp(
      dragStartRef.current.offset + deltaCandles,
      -futurePaddingCandles,
      Math.max(0, candles.length - visibleCount)
    );
    const committedDeltaCandles = nextOffset - dragStartRef.current.offset;
    const rawPreviewX = rawDeltaX - committedDeltaCandles * candleGap;
    const didHitBoundary = nextOffset !== dragStartRef.current.offset + deltaCandles;
    const pricePerPixel = visiblePriceRange / Math.max(1, chartHeight);
    const deltaY = event.clientY - dragStartRef.current.y;
    setOffset(nextOffset);
    setDragPreviewX(didHitBoundary ? rawPreviewX * DEMO_CHART_BOUNDARY_DRAG_RESISTANCE : rawPreviewX);
    setPricePan(dragStartRef.current.pricePan + deltaY * pricePerPixel);
  };

  const handleChartPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    updateCrosshair(event);
    moveRightDrag(event);
  };

  const handleChartWheel = (event: WheelEvent<SVGSVGElement>) => {
    const pointer = getSvgPointer(event, width, height);
    const isOverPriceScale = pointer.x >= axisX;
    const isPriceScaleGesture = isOverPriceScale || event.ctrlKey || event.metaKey;
    if (isPriceScaleGesture) {
      event.preventDefault();
      setCrosshair(null);
      const scaleFactor = Math.exp(event.deltaY / DEMO_CHART_PRICE_SCALE_WHEEL_SENSITIVITY);
      setPriceScale((scale) => clamp(scale * scaleFactor, MIN_DEMO_CHART_PRICE_SCALE, MAX_DEMO_CHART_PRICE_SCALE));
      return;
    }

    const horizontalDelta = Math.abs(event.deltaX) >= Math.abs(event.deltaY)
      ? event.deltaX
      : event.shiftKey
        ? event.deltaY
        : 0;
    if (horizontalDelta === 0) return;
    event.preventDefault();
    setCrosshair(null);
    wheelPanRemainderRef.current += horizontalDelta / Math.max(6, candleGap);
    const deltaCandles = Math.trunc(wheelPanRemainderRef.current);
    if (deltaCandles === 0) return;
    wheelPanRemainderRef.current -= deltaCandles;
    setOffset((value) => clamp(value - deltaCandles, -futurePaddingCandles, maxOffset));
  };

  const stopRightDrag = (event?: PointerEvent<SVGSVGElement>) => {
    if (event && dragStartRef.current && event.currentTarget.hasPointerCapture(dragStartRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(dragStartRef.current.pointerId);
    }
    if (event && priceScaleStartRef.current && event.currentTarget.hasPointerCapture(priceScaleStartRef.current.pointerId)) {
      event.currentTarget.releasePointerCapture(priceScaleStartRef.current.pointerId);
    }
    dragStartRef.current = null;
    priceScaleStartRef.current = null;
    setDragPreviewX(0);
    setIsRightDragging(false);
    setIsPriceScaling(false);
  };

  const leaveChart = () => {
    if (dragStartRef.current || priceScaleStartRef.current) return;
    setCrosshair(null);
  };
  const chartClassName = [
    "futures-candlestick-chart",
    "demo-trade-chart",
    readOnly ? "read-only" : "",
    isRightDragging ? "dragging" : "",
    isPriceScaling ? "scaling" : "",
    className
  ].filter(Boolean).join(" ");
  const statusTitle = error ? errorLabel : isLoading ? loadingLabel : emptyLabel;
  const statusDescription = error ?? (isLoading ? loadingDescription : emptyDescription);

  return (
    <div
      className="futures-candlestick-chart-shell demo-chart-shell"
      data-read-only={readOnly ? "true" : "false"}
      aria-busy={isLoading}
    >
      <div className="futures-candlestick-chart-controls demo-chart-controls">
        <div className="futures-chart-timeframe-tabs demo-timeframe-tabs" aria-label="Chart timeframe">
          {timeframeOptions.map((item) => (
            <button
              className={timeframe === item.value ? "active" : ""}
              type="button"
              onClick={() => onTimeframeChange?.(item.value)}
              disabled={!onTimeframeChange}
              key={item.value}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="futures-chart-icon-controls demo-chart-icon-controls" aria-label="Chart view controls">
          <button className="icon-button chart-control-button" type="button" onClick={() => zoomBy(-12)} title="Zoom in">
            <ZoomIn size={17} />
            <span className="sr-only">Zoom in</span>
          </button>
          <button className="icon-button chart-control-button" type="button" onClick={() => zoomBy(12)} title="Zoom out">
            <ZoomOut size={17} />
            <span className="sr-only">Zoom out</span>
          </button>
        </div>
      </div>

      {error && visibleCandles.length ? <p className="warning-box futures-chart-warning">{error}</p> : null}

      {visibleCandles.length ? (
        <svg
          className={chartClassName}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={startRightDrag}
          onPointerMove={handleChartPointerMove}
          onPointerUp={stopRightDrag}
          onPointerCancel={stopRightDrag}
          onLostPointerCapture={stopRightDrag}
          onPointerLeave={leaveChart}
          onWheel={handleChartWheel}
          onDoubleClick={resetPriceView}
        >
          <defs>
            <clipPath id={clipPathId}>
              <rect x={padding.left} y={padding.top} width={chartWidth} height={chartHeight} rx="4" />
            </clipPath>
          </defs>
          <rect width={width} height={height} rx="10" />
          <rect className="chart-axis-panel" x={axisX} y="0" width={padding.right} height={height} />
          {priceTicks.map((price) => {
            const y = yForPrice(price);
            return (
              <g key={price}>
                <line className="chart-grid-line" x1={padding.left} x2={axisX} y1={y} y2={y} />
                <text className="chart-price-label" x={axisX + 14} y={y + 4}>
                  {formatChartPrice(price)}
                </text>
              </g>
            );
          })}
          {verticalGridLines.map((x) => (
            <line
              className="chart-grid-line vertical"
              x1={x}
              x2={x}
              y1={padding.top}
              y2={height - padding.bottom}
              key={x}
            />
          ))}
          <g clipPath={`url(#${clipPathId})`}>
            {renderedZones.map(({ zone, y, height: zoneHeight }) => (
              <g className={`trade-overlay-zone ${zone.tone ?? "neutral"}`} key={zone.id}>
                <rect
                  x={padding.left}
                  y={y}
                  width={chartWidth}
                  height={zoneHeight}
                  fill={zone.color ?? defaultOverlayColor(zone.tone ?? "neutral")}
                  opacity={clamp(zone.opacity ?? 0.14, 0, 1)}
                />
                {zone.label ? (
                  <text className="chart-overlay-label" x={padding.left + 8} y={y + 16}>
                    {zone.label}
                  </text>
                ) : null}
              </g>
            ))}
            <g className="chart-candle-layer" transform={dragPreviewX ? `translate(${dragPreviewX} 0)` : undefined}>
              {renderedCandles.map((candle) => (
                <g className={candle.isUp ? "candle up" : "candle down"} key={candle.key}>
                  <line
                    className="candle-wick"
                    x1={candle.centerX}
                    x2={candle.centerX}
                    y1={candle.wickY1}
                    y2={candle.wickY2}
                  />
                  <rect
                    className="candle-body"
                    x={candle.candleX}
                    y={candle.bodyY}
                    width={candleWidth}
                    height={candle.bodyHeight}
                    rx="1.5"
                  />
                </g>
              ))}
            </g>
          </g>
          {overlayLineLayouts.map(({ line, lineY, markerY }, index) => {
            const hasPriceMarker = line.showPriceMarker ?? isOverlayPriceMarker(line.tone);
            const isMarkerShifted = Math.abs(markerY - lineY) > 1;
            const overlayClassName = [
              "trade-overlay-line",
              line.tone,
              line.tone === "entry" && line.side ? `side-${line.side}` : ""
            ].filter(Boolean).join(" ");
            const color = line.color ?? defaultOverlayColor(line.tone, true);
            return (
              <g className={overlayClassName} key={line.id ?? `${line.label}-${line.price}-${index}`}>
                <line x1={padding.left} x2={axisX} y1={lineY} y2={lineY} stroke={color} />
                {isMarkerShifted ? (
                  <line
                    className="chart-marker-connector"
                    x1={axisX}
                    x2={axisX + 8}
                    y1={lineY}
                    y2={markerY}
                    stroke={color}
                  />
                ) : null}
                {hasPriceMarker ? (
                  <>
                    <rect
                      className="chart-price-marker"
                      x={axisX + 8}
                      y={markerY - 16}
                      width="88"
                      height="30"
                      rx="4"
                      fill={line.color ?? defaultOverlayColor(line.tone, false)}
                    />
                    <text className="chart-price-marker-label" x={axisX + 16} y={markerY - 5}>
                      {line.label.toUpperCase()}
                    </text>
                    <text className="chart-price-marker-text" x={axisX + 16} y={markerY + 9}>
                      {formatChartPrice(line.price)}
                    </text>
                  </>
                ) : (
                  <text x={axisX + 14} y={markerY + 4}>
                    {line.label}
                  </text>
                )}
                {(line.showPlotLabel ?? (line.tone !== "mark" && line.tone !== "entry")) ? (
                  <text className="chart-overlay-label" x={padding.left + 8} y={lineY - 6}>
                    {line.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {crosshair ? (
            <g className="chart-crosshair" aria-hidden="true">
              <line className="chart-crosshair-line" x1={padding.left} x2={axisX} y1={crosshair.y} y2={crosshair.y} />
              <line className="chart-crosshair-line" x1={crosshair.x} x2={crosshair.x} y1={padding.top} y2={height - padding.bottom} />
              <rect className="chart-crosshair-price" x={axisX + 8} y={crosshair.y - 14} width="86" height="28" rx="4" />
              <text className="chart-crosshair-price-text" x={axisX + 16} y={crosshair.y + 4}>
                {formatChartPrice(crosshair.price)}
              </text>
            </g>
          ) : null}
        </svg>
      ) : (
        <div className="futures-chart-empty demo-chart-empty" role={error ? "alert" : "status"}>
          <LineChart size={28} />
          <strong>{statusTitle}</strong>
          <span>{statusDescription}</span>
        </div>
      )}
    </div>
  );
}

function isValidOverlayLine(line: FuturesChartOverlayLine): boolean {
  return isPositiveFinite(line.price) && Boolean(line.label.trim());
}

function isValidOverlayZone(zone: FuturesChartOverlayZone): boolean {
  return Boolean(zone.id) && isPositiveFinite(zone.lowPrice) && isPositiveFinite(zone.highPrice);
}

function isPositiveFinite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function defaultOverlayColor(tone: FuturesChartOverlayTone, line = false): string | undefined {
  if (["mark", "entry", "pending", "target", "hit", "danger", "liquidation"].includes(tone)) return undefined;
  if (tone === "support") return line ? "rgba(126, 224, 167, 0.92)" : "rgba(69, 174, 116, 0.92)";
  if (tone === "resistance" || tone === "invalidation") {
    return line ? "rgba(255, 107, 107, 0.92)" : "rgba(210, 71, 77, 0.92)";
  }
  return line ? "rgba(184, 214, 222, 0.72)" : "rgba(97, 181, 201, 0.82)";
}

function buildCandleShape({
  openY,
  closeY,
  highY,
  lowY,
  minBodyHeight,
  minWickHeight
}: {
  openY: number;
  closeY: number;
  highY: number;
  lowY: number;
  minBodyHeight: number;
  minWickHeight: number;
}) {
  const rawBodyHeight = Math.abs(openY - closeY);
  const bodyHeight = snapSvgLength(Math.max(minBodyHeight, rawBodyHeight));
  const bodyCenter = (openY + closeY) / 2;
  const bodyY = snapSvgCoordinate(bodyCenter - bodyHeight / 2);
  const renderedBodyCenter = bodyY + bodyHeight / 2;
  const wickY1 = snapSvgCoordinate(Math.min(highY, lowY, bodyY, renderedBodyCenter - minWickHeight / 2));
  const wickY2 = snapSvgCoordinate(Math.max(highY, lowY, bodyY + bodyHeight, renderedBodyCenter + minWickHeight / 2));
  return { bodyY, bodyHeight, wickY1, wickY2 };
}

function snapSvgCoordinate(value: number): number {
  return Math.round(value);
}

function snapSvgLength(value: number): number {
  return Math.max(1, Math.round(value));
}

function snapCandleBodyWidth(value: number): number {
  return Math.max(2, Math.round(value));
}

function getSvgPointer(
  event: { clientX: number; clientY: number; currentTarget: SVGSVGElement },
  width: number,
  height: number
) {
  const bounds = event.currentTarget.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * width,
    y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * height
  };
}

function isBracketPriceMarker(tone: FuturesChartOverlayTone): boolean {
  return tone === "target"
    || tone === "hit"
    || tone === "danger"
    || tone === "liquidation"
    || tone === "invalidation";
}

function isOverlayPriceMarker(tone: FuturesChartOverlayTone): boolean {
  return tone === "mark" || tone === "entry" || tone === "pending" || isBracketPriceMarker(tone);
}

function resolveOverlayMarkerLayouts(
  layouts: OverlayLineLayout[],
  minY: number,
  maxY: number
): OverlayLineLayout[] {
  if (layouts.length < 2) return layouts;
  const minGap = 30;
  const sorted = layouts
    .map((layout, index) => ({ ...layout, index }))
    .sort((a, b) => a.markerY - b.markerY || b.line.price - a.line.price || a.index - b.index);
  sorted.forEach((layout) => {
    layout.markerY = clamp(layout.markerY, minY, maxY);
  });

  const clusters: Array<typeof sorted> = [];
  let cluster: typeof sorted = [sorted[0]];
  for (let index = 1; index < sorted.length; index += 1) {
    const previous = sorted[index - 1];
    const current = sorted[index];
    if (current.markerY - previous.markerY < minGap) {
      cluster.push(current);
    } else {
      clusters.push(cluster);
      cluster = [current];
    }
  }
  clusters.push(cluster);
  clusters.forEach((items) => resolveOverlayMarkerCluster(items, minGap, minY, maxY));
  return sorted
    .sort((a, b) => a.index - b.index)
    .map(({ index, ...layout }) => layout);
}

function resolveOverlayMarkerCluster(
  layouts: Array<OverlayLineLayout & { index: number }>,
  minGap: number,
  minY: number,
  maxY: number
): void {
  if (layouts.length < 2) return;
  for (let index = 1; index < layouts.length; index += 1) {
    layouts[index].markerY = Math.max(layouts[index].markerY, layouts[index - 1].markerY + minGap);
  }
  const bottomOverflow = layouts[layouts.length - 1].markerY - maxY;
  if (bottomOverflow > 0) layouts.forEach((layout) => (layout.markerY -= bottomOverflow));
  for (let index = layouts.length - 2; index >= 0; index -= 1) {
    layouts[index].markerY = Math.min(layouts[index].markerY, layouts[index + 1].markerY - minGap);
  }
  const topOverflow = minY - layouts[0].markerY;
  if (topOverflow > 0) layouts.forEach((layout) => (layout.markerY += topOverflow));
}

function formatChartPrice(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: value >= 1000 ? 1 : 2,
    maximumFractionDigits: value >= 1000 ? 1 : 2
  });
}

function defaultVisibleCandles(timeframe: string): number {
  if (timeframe === "1m") return 62;
  if (timeframe === "5m") return 74;
  if (timeframe === "1M") return 48;
  if (timeframe === "1w") return 72;
  if (timeframe === "1d") return 80;
  return 90;
}

function isBullishCandle(candle: FuturesChartCandle, previousClose = candle.open): boolean {
  return candle.close === candle.open ? candle.close >= previousClose : candle.close > candle.open;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
