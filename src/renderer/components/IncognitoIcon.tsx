// Ícone da aba anônima (chapéu + óculos, o mesmo desenho que todo mundo conhece do Chrome).
// Desenhado aqui, sem buscar nada: na aba anônima o Bah não pede o favicon do site pela própria
// interface (esse pedido ficaria no cache em disco da interface).
import React from 'react';

export default function IncognitoIcon({ size = 16, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="currentColor"
      role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      {/* chapéu: copa + aba */}
      <path d="M6.2 9.6 7.9 4.4c.2-.6.8-.9 1.4-.7l2.7.9 2.7-.9c.6-.2 1.2.1 1.4.7l1.7 5.2z" />
      <rect x="2" y="10.4" width="20" height="2" rx="1" />
      {/* óculos */}
      <circle cx="7.3" cy="16.8" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="16.7" cy="16.8" r="2.7" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M10 16.4c1.3-.8 2.7-.8 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}
