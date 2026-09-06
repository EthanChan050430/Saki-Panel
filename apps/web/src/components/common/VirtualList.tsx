// Fixed-height virtual list for rendering large collections O(visible) nodes.
//
// MVP scopes:
//   - Fixed row height (computed once from first rendered row).
//   - No dynamic height measurement, no item reuse pools.
//   - Window margin of 2 rows above/below to reduce flicker on fast scroll.
//   - Root container MUST have an explicit height (flex child or fixed px).
//
// Usage:
//   <VirtualList
//     items={bigArray}
//     estimatedRowHeight={36}
//     renderItem={(item, index) => <Row key={item.id} item={item} index={index} />}
//   />
//
// Integration notes:
//   - Scroll happens on the component's own root div; parent should not
//     overflow: auto on the same axis or scrolling will fight for events.
//   - Focus management is the caller's responsibility; VirtualList does not
//     attach to the tab sequence.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

interface VirtualListProps<T> {
  items: readonly T[];
  estimatedRowHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;       // extra rows above/below the viewport; default 2
  className?: string;
  rowClassName?: string;
}

export function VirtualList<T>({
  items,
  estimatedRowHeight,
  renderItem,
  overscan = 2,
  className = "",
  rowClassName = "",
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [measuredRowHeight, setMeasuredRowHeight] = useState<number | null>(null);

  const rowHeight = measuredRowHeight ?? estimatedRowHeight;
  const totalHeight = items.length * rowHeight;

  // Measure first row's actual height on mount / items change / resize.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const measure = () => {
      setViewportHeight(container.clientHeight);
      // Probe first rendered row for real height (if any).
      const probe = container.querySelector<HTMLDivElement>("[data-vl-row='0']");
      if (probe) {
        const h = probe.getBoundingClientRect().height;
        if (h > 0 && h !== measuredRowHeight) setMeasuredRowHeight(h);
      }
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [items.length, measuredRowHeight]);

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIdx = Math.min(
    items.length,
    Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
  );
  const visibleItems = items.slice(startIdx, endIdx);

  const offsetStyle: React.CSSProperties = {
    height: totalHeight,
    position: "relative",
  };

  return (
    <div
      ref={containerRef}
      className={`virtual-list ${className}`}
      onScroll={onScroll}
      role="list"
    >
      <div className="virtual-list-offset" style={offsetStyle}>
        {visibleItems.map((item, i) => {
          const index = startIdx + i;
          return (
            <div
              key={index}
              data-vl-row={index}
              className={`virtual-list-row ${rowClassName}`}
              style={{
                position: "absolute",
                top: index * rowHeight,
                left: 0,
                right: 0,
                height: rowHeight,
              }}
              role="listitem"
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}
