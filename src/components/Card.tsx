import  { ReactNode } from 'react';
import { motion } from 'framer-motion';

interface CardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

export default function Card({ children, className = '', hover = false }: CardProps) {
  return (
    <motion.div
      className={`bg-white dark:bg-gray-800 rounded-xl material-elevation-1 ${className}`}
      whileHover={hover ? { scale: 1.02, boxShadow: '0 8px 25px rgba(0,0,0,0.15)' } : {}}
      transition={{ duration: 0.2 }}
    >
      {children}
    </motion.div>
  );
}
 