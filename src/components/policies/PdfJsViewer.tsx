import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";

interface PdfJsViewerProps {
  url: string;
  className?: string;
}

export function PdfJsViewer({ url, className = "" }: PdfJsViewerProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    const loadPdf = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/proxy-cdn-file`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`
            },
            body: JSON.stringify({ url })
          }
        );

        if (!response.ok) throw new Error('Failed to load PDF');
        if (cancelled) return;

        const blob = await response.blob();
        if (cancelled) return;

        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err: any) {
        console.error('PDF load error:', err);
        if (!cancelled) {
          setError(err.message || 'فشل تحميل الملف');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadPdf();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-2" />
          <p className="text-muted-foreground text-sm">جاري تحميل الملف...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex items-center justify-center ${className}`}>
        <div className="text-center text-destructive">
          <p className="mb-2">{error}</p>
          <a 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-primary underline text-sm"
          >
            فتح في نافذة جديدة
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col ${className}`}>
      <iframe
        src={blobUrl!}
        className="w-full h-full border-0 rounded-lg"
        title="PDF Viewer"
      />
    </div>
  );
}
