'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

function formatSlug(slug: string): string {
  return slug
    .replace(/[-_]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

export default function DynamicTitle() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    const updateTitle = () => {
      // 1. Agar page par h1 mojood hai toh uska text le lo
      const h1Element = document.querySelector('h1');
      const h1Text = h1Element?.textContent?.trim();

      if (h1Text && h1Text.length > 1 && h1Text.length < 60) {
        document.title = `Mysmar Airdesk ERP - ${h1Text}`;
        return;
      }

      // 2. Fallback: Agar h1 na mile toh URL pathname se title generate karo
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length === 0) {
        document.title = 'Mysmar Airdesk ERP';
        return;
      }

      const lastSegment = segments[segments.length - 1];
      const pageTitle = formatSlug(lastSegment);

      document.title = `Mysmar Airdesk ERP - ${pageTitle}`;
    };

    // React render hone ke baad microtask mein run karein taake h1 load ho chuka ho
    const timer = setTimeout(updateTitle, 100);

    return () => clearTimeout(timer);
  }, [pathname]);

  return null;
}