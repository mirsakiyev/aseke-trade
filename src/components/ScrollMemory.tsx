import { useEffect, useMemo, useRef } from "react";
import { useLocation } from "react-router-dom";

type ScrollPosition = {
  x: number;
  y: number;
};

const scrollPositions = new Map<string, ScrollPosition>();
const restoreDurationMs = 7000;

function createScrollKey(pathname: string, search: string, hash: string): string {
  return `${pathname}${search}${hash}`;
}

function readScrollPosition(): ScrollPosition {
  return {
    x: window.scrollX,
    y: window.scrollY
  };
}

function saveScrollPosition(scrollKey: string) {
  scrollPositions.set(scrollKey, readScrollPosition());
}

function scrollToPosition(position: ScrollPosition) {
  const previousBehavior = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = "auto";
  window.scrollTo(position.x, position.y);
  document.documentElement.style.scrollBehavior = previousBehavior;
}

function restoreScrollPosition(scrollKey: string, onRestoringChange: (isRestoring: boolean) => void): () => void {
  const savedPosition = scrollPositions.get(scrollKey);
  if (!savedPosition) return () => undefined;

  let animationFrame = 0;
  let isCancelled = false;
  const startedAt = Date.now();
  onRestoringChange(true);

  const restore = () => {
    if (isCancelled) return;

    const maxX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth);
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const targetPosition = {
      x: Math.min(savedPosition.x, maxX),
      y: Math.min(savedPosition.y, maxY)
    };
    const isPageTallEnough = maxY >= savedPosition.y;
    const isPageWideEnough = maxX >= savedPosition.x;
    const isAtTarget =
      Math.abs(window.scrollX - targetPosition.x) <= 2 && Math.abs(window.scrollY - targetPosition.y) <= 2;
    const isExpired = Date.now() - startedAt > restoreDurationMs;

    scrollToPosition(targetPosition);

    if ((isAtTarget && isPageTallEnough && isPageWideEnough) || isExpired) {
      onRestoringChange(false);
      return;
    }
    animationFrame = window.requestAnimationFrame(restore);
  };

  animationFrame = window.requestAnimationFrame(restore);

  return () => {
    isCancelled = true;
    onRestoringChange(false);
    window.cancelAnimationFrame(animationFrame);
  };
}

export function ScrollMemory() {
  const location = useLocation();
  const scrollKey = useMemo(
    () => createScrollKey(location.pathname, location.search, location.hash),
    [location.hash, location.pathname, location.search]
  );
  const scrollKeyRef = useRef(scrollKey);
  const cancelRestoreRef = useRef<() => void>(() => undefined);
  const isRestoringRef = useRef(false);

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    if (scrollKeyRef.current === scrollKey) return;

    saveScrollPosition(scrollKeyRef.current);
    scrollKeyRef.current = scrollKey;
    cancelRestoreRef.current();
    cancelRestoreRef.current = restoreScrollPosition(scrollKey, (isRestoring) => {
      isRestoringRef.current = isRestoring;
    });
  }, [scrollKey]);

  useEffect(() => {
    let pendingFrame = 0;

    const saveCurrentScroll = (force = false) => {
      if (!force && (document.visibilityState !== "visible" || isRestoringRef.current)) return;

      saveScrollPosition(scrollKeyRef.current);
    };

    const queueSaveCurrentScroll = () => {
      if (pendingFrame) return;

      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = 0;
        saveCurrentScroll();
      });
    };

    const restoreCurrentScroll = () => {
      cancelRestoreRef.current();
      cancelRestoreRef.current = restoreScrollPosition(scrollKeyRef.current, (isRestoring) => {
        isRestoringRef.current = isRestoring;
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        saveCurrentScroll(true);
        return;
      }

      if (document.visibilityState === "visible") {
        restoreCurrentScroll();
      }
    };
    const handlePageHide = () => saveCurrentScroll(true);

    window.addEventListener("scroll", queueSaveCurrentScroll, { passive: true });
    window.addEventListener("resize", queueSaveCurrentScroll);
    window.addEventListener("focus", restoreCurrentScroll);
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (pendingFrame) window.cancelAnimationFrame(pendingFrame);
      saveCurrentScroll();
      cancelRestoreRef.current();
      window.removeEventListener("scroll", queueSaveCurrentScroll);
      window.removeEventListener("resize", queueSaveCurrentScroll);
      window.removeEventListener("focus", restoreCurrentScroll);
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return null;
}
