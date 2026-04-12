/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        primary: {
          DEFAULT: '#1a3c8f',
          50: '#eef2ff',
          100: '#dce4ff',
          200: '#b9caff',
          300: '#7fa0ff',
          400: '#4a6fd4',
          500: '#1a3c8f',
          600: '#142f72',
          700: '#0f2358',
          800: '#0a1940',
          900: '#060e28',
        },
        accent: {
          DEFAULT: '#00c896',
          50: '#e6fff7',
          100: '#b3ffe7',
          200: '#66ffd0',
          300: '#00c896',
          400: '#00a67d',
          500: '#008564',
          light: '#e0fff5',
        },
        danger: {
          DEFAULT: '#e53935',
          light: '#ffebee',
          dark: '#b71c1c',
        },
        warning: {
          DEFAULT: '#f59e0b',
          light: '#fef3c7',
          dark: '#92400e',
        },
        success: {
          DEFAULT: '#00c896',
          light: '#e0fff5',
          dark: '#006b50',
        },
        surface: {
          DEFAULT: '#f4f6fa',
          card: '#ffffff',
          sidebar: '#ffffff',
          dark: '#0a0f1e',
          'dark-card': '#111827',
        },
        on: {
          surface: '#1a1a2e',
          'surface-variant': '#64748b',
          'surface-muted': '#94a3b8',
        },
        hero: {
          DEFAULT: '#1a1a3e',
          light: '#2a2a5e',
        },
      },
      borderRadius: {
        'card': '16px',
        'btn': '10px',
      },
      boxShadow: {
        'card': '0 2px 12px rgba(0,0,0,0.08)',
        'card-hover': '0 4px 20px rgba(0,0,0,0.12)',
        'sidebar': '2px 0 20px rgba(0,0,0,0.06)',
        'btn': '0 2px 8px rgba(26,60,143,0.15)',
        'btn-hover': '0 4px 16px rgba(26,60,143,0.25)',
        'hero': '0 8px 32px rgba(26,26,62,0.3)',
        'glow-teal': '0 0 30px rgba(0,200,150,0.3), 0 0 80px rgba(0,200,150,0.15)',
        'glow-teal-lg': '0 0 60px rgba(0,200,150,0.4), 0 0 120px rgba(0,200,150,0.2)',
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.5s cubic-bezier(0.4, 0, 0.2, 1) both',
        'fade-in-scale': 'fadeInScale 0.4s cubic-bezier(0.4, 0, 0.2, 1) both',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.4, 0, 0.2, 1) both',
        'slide-in-right': 'slideInRight 0.3s ease-out both',
        'flash-in': 'flashIn 0.35s ease-out both',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'breathe': 'breathe 4s ease-in-out infinite',
        'orbit': 'orbit 8s linear infinite',
        'shimmer': 'shimmer 1.5s ease-in-out infinite',
        'spin-slow': 'spin 3s linear infinite',
        'bounce-soft': 'bounceSoft 1s ease-in-out infinite',
        'notification-in': 'notificationIn 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
        'notification-out': 'notificationOut 0.3s ease-in both',
        'turn-flash': 'turnFlash 0.5s ease-in-out infinite alternate',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeInScale: {
          '0%': { opacity: '0', transform: 'scale(0.95)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideInRight: {
          '0%': { opacity: '0', transform: 'translateX(30px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        flashIn: {
          '0%': { opacity: '0', transform: 'translateY(-10px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 30px rgba(0,200,150,0.3)' },
          '50%': { boxShadow: '0 0 60px rgba(0,200,150,0.5), 0 0 100px rgba(0,200,150,0.2)' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '0.8', transform: 'scale(1.05)' },
        },
        orbit: {
          from: { transform: 'rotate(0deg)' },
          to: { transform: 'rotate(360deg)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        bounceSoft: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        notificationIn: {
          '0%': { opacity: '0', transform: 'translateY(20px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        notificationOut: {
          '0%': { opacity: '1', transform: 'translateY(0)' },
          '100%': { opacity: '0', transform: 'translateY(20px)' },
        },
        turnFlash: {
          '0%': { backgroundColor: 'rgba(0,200,150,0.9)' },
          '100%': { backgroundColor: 'rgba(0,200,150,1)' },
        },
      },
    },
  },
  plugins: [],
};
