import type { CSSProperties, ReactElement } from 'react';
import './Skeleton.css';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  circle?: boolean;
}

export function Skeleton({ className = '', width, height, circle }: SkeletonProps): ReactElement {
  const style: CSSProperties = {};
  if (width !== undefined) style.width = width;
  if (height !== undefined) style.height = height;
  return (
    <div
      className={`sg-skeleton ${circle ? 'sg-skeleton--circle' : 'sg-skeleton--text'} ${className}`}
      aria-hidden="true"
      style={style}
    />
  );
}
