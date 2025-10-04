import  { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  elevation?: 1 | 2 | 3 | 4 | 6 | 8 | 12 | 16 | 24;
}

export default function Card({ children, className = '', onClick, elevation = 1 }: CardProps) {
  return (
    <motion.div
      onClick={onClick}
      whileHover={{ 
        y: onClick ? -2 : 0,
        boxShadow: onClick ? `var(--md-elevation-${Math.min(elevation + 2, 24)})` : undefined
      }}
      whileTap={{ scale: onClick ? 0.98 : 1 }}
      className={`
        md-surface rounded-lg transition-all duration-300 md-standard
        md-elevation-${elevation}
        ${onClick ? 'cursor-pointer md-ripple' : ''}
        ${className}
      `}
    >
      {children}
    </motion.div>
  );
}
 