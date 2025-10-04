import  { ButtonHTMLAttributes, ReactNode } from 'react';
import { motion } from 'framer-motion';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'contained' | 'outlined' | 'text';
  color?: 'primary' | 'secondary' | 'error';
  size?: 'small' | 'medium' | 'large';
  children: ReactNode;
  elevation?: 1 | 2 | 3 | 4 | 6 | 8;
}

export default function Button({ 
  variant = 'contained', 
  color = 'primary',
  size = 'medium', 
  children, 
  className = '', 
  disabled,
  elevation = 2,
  ...props 
}: ButtonProps) {
  const baseClasses = 'inline-flex items-center justify-center gap-2 rounded md-button transition-all duration-200 md-standard focus:outline-none focus:ring-2 focus:ring-offset-2 md-ripple';
  
  const variants = {
    contained: {
      primary: `bg-blue-600 hover:bg-blue-700 text-white md-elevation-${elevation} hover:md-elevation-${Math.min(elevation + 2, 8)} focus:ring-blue-500`,
      secondary: `bg-pink-600 hover:bg-pink-700 text-white md-elevation-${elevation} hover:md-elevation-${Math.min(elevation + 2, 8)} focus:ring-pink-500`,
      error: `bg-red-600 hover:bg-red-700 text-white md-elevation-${elevation} hover:md-elevation-${Math.min(elevation + 2, 8)} focus:ring-red-500`
    },
    outlined: {
      primary: 'border-2 border-blue-600 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus:ring-blue-500',
      secondary: 'border-2 border-pink-600 text-pink-600 hover:bg-pink-50 dark:hover:bg-pink-900/20 focus:ring-pink-500',
      error: 'border-2 border-red-600 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 focus:ring-red-500'
    },
    text: {
      primary: 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 focus:ring-blue-500',
      secondary: 'text-pink-600 hover:bg-pink-50 dark:hover:bg-pink-900/20 focus:ring-pink-500',
      error: 'text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 focus:ring-red-500'
    }
  };
  
  const sizes = {
    small: 'px-3 py-1.5 text-sm',
    medium: 'px-4 py-2 text-base',
    large: 'px-6 py-3 text-lg'
  };

  return (
    <motion.button
      whileHover={{ scale: disabled ? 1 : 1.02 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className={`
        ${baseClasses}
        ${variants[variant][color]}
        ${sizes[size]}
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `}
      disabled={disabled}
      {...props}
    >
      {children}
    </motion.button>
  );
}
 