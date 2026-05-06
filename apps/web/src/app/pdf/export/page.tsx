'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function PdfExportPage() {
  const router = useRouter();
  useEffect(() => { router.replace('/pdf'); }, [router]);
  return null;
}
