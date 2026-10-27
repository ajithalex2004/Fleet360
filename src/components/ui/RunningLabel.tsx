'use client';

import React, { useRef, useState, useEffect } from 'react';

interface RunningLabelProps {
  text: string;
  className?: string;
}

export function RunningLabel({ text, className = '' }: RunningLabelProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [distance, setDistance] = useState<number>(0);

  useEffect(() => {
    const check = () => {
      if (containerRef.current && textRef.current) {
        const cWidth = containerRef.current.clientWidth;
        const sWidth = textRef.current.scrollWidth;
        if (sWidth > cWidth && cWidth > 0) {
          setIsOverflowing(true);
          setDistance(sWidth - cWidth + 12);
        } else {
          setIsOverflowing(false);
          setDistance(0);
        }
      }
    };
    check();
    const ro = new ResizeObserver(check);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span
      ref={containerRef}
      className={`running-label-wrap ${className}`}
      title={isOverflowing ? text : undefined}
    >
      <span
        ref={textRef}
        className={`running-label-inner ${isOverflowing ? 'is-overflowing' : 'truncate'}`}
        style={
          isOverflowing
            ? ({ '--marquee-distance': `-${distance}px` } as React.CSSProperties)
            : undefined
        }
      >
        {text}
      </span>
    </span>
  );
}

export default RunningLabel;
