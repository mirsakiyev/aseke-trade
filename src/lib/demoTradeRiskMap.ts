export type PositionRiskMarkerTone = "liquidation" | "stop" | "mark" | "entry" | "take-profit";
export type PositionRiskMarkerPlacement = "above" | "below";
export type PositionRiskMarkerAnchor = "start" | "center" | "end";
export type PositionRiskScaleMode = "linear" | "compressed-left";

export interface PositionRiskMarkerDraft {
  label: string;
  detailLabel?: string;
  price: number;
  tone: PositionRiskMarkerTone;
}

export interface PositionRiskMarker extends PositionRiskMarkerDraft {
  percent: number;
}

export interface PositionRiskMarkerLayout extends PositionRiskMarker {
  labelPercent: number;
  placement: PositionRiskMarkerPlacement;
  anchor: PositionRiskMarkerAnchor;
  lane: number;
}

export interface PositionRiskScale {
  mode: PositionRiskScaleMode;
  markers: PositionRiskMarker[];
}

const FAR_LIQUIDATION_ACTIVE_BAND_LEFT = [34, 92] as const;
const FAR_LIQUIDATION_EDGE_LEFT = 8;

export function resolvePositionRiskScale(rawMarkers: PositionRiskMarkerDraft[]): PositionRiskScale {
  const markers = rawMarkers.filter((marker) => Number.isFinite(marker.price) && marker.price > 0);
  if (!markers.length) return { mode: "linear", markers: [] };
  const invertScale = isInvertedRiskScale(markers);

  const compressedScale = resolveCompressedLiquidationScale(markers, invertScale);
  if (compressedScale) return compressedScale;

  return {
    mode: "linear",
    markers: applyLinearRiskScale(markers, invertScale)
  };
}

export function resolveRiskMarkerLayouts(markers: PositionRiskMarker[]): PositionRiskMarkerLayout[] {
  if (!markers.length) return [];

  const minGap = clampValue(96 / Math.max(1, markers.length - 1), 12, 17);
  const layouts = markers.map((marker, index) => ({
    ...marker,
    index,
    labelPercent: clampValue(marker.percent, 8, 92),
    placement: getRiskMarkerPlacement(marker),
    anchor: "center" as PositionRiskMarkerAnchor,
    lane: 0
  }));

  (["above", "below"] as PositionRiskMarkerPlacement[]).forEach((placement) => {
    const group = layouts
      .filter((marker) => marker.placement === placement)
      .sort((a, b) => a.labelPercent - b.labelPercent || a.index - b.index);

    placeRiskLabelsInLanes(group, placement === "above" ? getRiskMarkerLaneCount(group.length) : 1, minGap);
  });

  layouts.forEach((marker) => {
    marker.anchor = getRiskMarkerAnchor(marker.labelPercent);
  });

  return layouts
    .sort((a, b) => a.index - b.index)
    .map(({ index, ...marker }) => marker);
}

function resolveCompressedLiquidationScale(markers: PositionRiskMarkerDraft[], invertScale: boolean): PositionRiskScale | null {
  const liquidationMarker = markers.find((marker) => marker.tone === "liquidation");
  const activeMarkers = markers.filter((marker) => marker.tone !== "liquidation");
  if (!liquidationMarker || !activeMarkers.length) return null;

  const activePrices = activeMarkers.map((marker) => marker.price);
  const activeMin = Math.min(...activePrices);
  const activeMax = Math.max(...activePrices);
  const scaleMagnitude = Math.max(...markers.map((marker) => Math.abs(marker.price)), 1);
  const activeRange = Math.max(activeMax - activeMin, scaleMagnitude * 0.006, 1);
  const farDistanceThreshold = Math.max(activeRange * 3.2, scaleMagnitude * 0.035);
  const liquidationDistance = invertScale ? liquidationMarker.price - activeMax : activeMin - liquidationMarker.price;

  if (liquidationDistance <= farDistanceThreshold) return null;

  const [activeBandStart, activeBandEnd] = FAR_LIQUIDATION_ACTIVE_BAND_LEFT;
  const activeScaleMin = activeMin - activeRange * 0.1;
  const activeScaleMax = activeMax + activeRange * 0.1;
  const activeScaleRange = Math.max(activeScaleMax - activeScaleMin, 1);

  return {
    mode: "compressed-left",
    markers: markers.map((marker) => {
      if (marker === liquidationMarker) {
        return { ...marker, percent: FAR_LIQUIDATION_EDGE_LEFT };
      }

      const activeRatio = invertScale
        ? (activeScaleMax - marker.price) / activeScaleRange
        : (marker.price - activeScaleMin) / activeScaleRange;
      const activePercent = activeBandStart + activeRatio * (activeBandEnd - activeBandStart);
      return {
        ...marker,
        percent: clampValue(activePercent, activeBandStart, activeBandEnd)
      };
    })
  };
}

function applyLinearRiskScale(markers: PositionRiskMarkerDraft[], invertScale: boolean): PositionRiskMarker[] {
  const prices = markers.map((marker) => marker.price);
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const rawRange = Math.max(maxPrice - minPrice, Math.max(Math.abs(maxPrice) * 0.004, 1));
  const paddedMin = minPrice - rawRange * 0.08;
  const paddedMax = maxPrice + rawRange * 0.08;
  const range = Math.max(paddedMax - paddedMin, 1);

  return markers.map((marker) => ({
    ...marker,
    percent: clampValue((invertScale ? (paddedMax - marker.price) / range : (marker.price - paddedMin) / range) * 100, 0, 100)
  }));
}

function isInvertedRiskScale(markers: PositionRiskMarkerDraft[]): boolean {
  const liquidationMarker = markers.find((marker) => marker.tone === "liquidation");
  const activeMarkers = markers.filter((marker) => marker.tone !== "liquidation");
  if (!liquidationMarker || !activeMarkers.length) return false;

  const activePrices = activeMarkers.map((marker) => marker.price);
  const activeMidpoint = (Math.min(...activePrices) + Math.max(...activePrices)) / 2;
  return liquidationMarker.price > activeMidpoint;
}

function getRiskMarkerPlacement(marker: PositionRiskMarker): PositionRiskMarkerPlacement {
  return marker.tone === "mark" ? "below" : "above";
}

function getRiskMarkerLaneCount(markerCount: number): number {
  return clampValue(Math.ceil(markerCount / 2), 2, 3);
}

function getRiskMarkerAnchor(labelPercent: number): PositionRiskMarkerAnchor {
  if (labelPercent <= 10) return "start";
  if (labelPercent >= 90) return "end";
  return "center";
}

function placeRiskLabelsInLanes(
  markers: Array<PositionRiskMarkerLayout & { index: number }>,
  laneCount: number,
  minGap: number
): void {
  if (!markers.length) return;

  const laneRightEdges = Array.from({ length: laneCount }, () => -Infinity);

  markers.forEach((marker) => {
    const openLane = laneRightEdges.findIndex((rightEdge) => marker.labelPercent - rightEdge >= minGap);
    const lane = openLane >= 0 ? openLane : laneRightEdges.indexOf(Math.min(...laneRightEdges));
    marker.lane = Math.max(0, lane);
    if (openLane < 0) {
      marker.labelPercent = clampValue(laneRightEdges[lane] + minGap, 8, 92);
    }
    laneRightEdges[marker.lane] = marker.labelPercent;
  });

  Array.from({ length: laneCount }, (_, lane) => {
    const laneMarkers = markers.filter((marker) => marker.lane === lane);
    nudgeRiskLaneInsideBounds(laneMarkers, minGap);
  });
}

function nudgeRiskLaneInsideBounds(markers: Array<PositionRiskMarkerLayout & { index: number }>, minGap: number): void {
  if (markers.length < 2) return;

  for (let index = 1; index < markers.length; index += 1) {
    markers[index].labelPercent = Math.max(markers[index].labelPercent, markers[index - 1].labelPercent + minGap);
  }

  const rightOverflow = markers[markers.length - 1].labelPercent - 92;
  if (rightOverflow > 0) markers.forEach((marker) => (marker.labelPercent -= rightOverflow));

  for (let index = markers.length - 2; index >= 0; index -= 1) {
    markers[index].labelPercent = Math.min(markers[index].labelPercent, markers[index + 1].labelPercent - minGap);
  }

  const leftOverflow = 8 - markers[0].labelPercent;
  if (leftOverflow > 0) markers.forEach((marker) => (marker.labelPercent += leftOverflow));
}

function clampValue(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
