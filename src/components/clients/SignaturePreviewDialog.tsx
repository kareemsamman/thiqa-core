import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useSiteSettings } from "@/hooks/useSiteSettings";
import { getFullCdnUrl } from "@/lib/utils";
import DOMPurify from "dompurify";

interface SignaturePreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  signatureUrl: string | null;
}

export function SignaturePreviewDialog({
  open,
  onOpenChange,
  clientName,
  signatureUrl,
}: SignaturePreviewDialogProps) {
  const { data: settings, isLoading } = useSiteSettings();

  const fullSignatureUrl = getFullCdnUrl(signatureUrl);
  const logoUrl = getFullCdnUrl(settings?.logo_url ?? null);

  const logoHtml = logoUrl
    ? `<div style="text-align:center;margin-bottom:20px;"><img src="${logoUrl}" alt="Logo" style="max-height:80px;max-width:200px;" /></div>`
    : "";

  const signatureImageHtml = fullSignatureUrl
    ? `
      <div style="margin:30px 0;padding:20px;border:2px solid #10b981;border-radius:12px;background:#f0fdf4;">
        <h4 style="text-align:center;color:#059669;margin:0 0 15px 0;font-size:16px;">توقيع العميل</h4>
        <div style="text-align:center;background:white;padding:15px;border-radius:8px;border:1px solid #e5e7eb;">
          <img src="${fullSignatureUrl}" alt="توقيع العميل" style="max-width:100%;max-height:150px;object-fit:contain;" />
        </div>
        <p style="text-align:center;margin:10px 0 0 0;font-size:12px;color:#6b7280;">${clientName}</p>
      </div>
    `
    : "";

  const html = `
    <!DOCTYPE html>
    <html dir="rtl" lang="ar">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.8; padding: 20px; max-width: 800px; margin: 0 auto; color: #374151; }
        h2, h3, h4 { color: #1f2937; }
        ul { padding-right: 20px; }
        li { margin-bottom: 8px; }
      </style>
    </head>
    <body>
      ${logoHtml}
      ${settings?.signature_header_html || ""}
      ${settings?.signature_body_html || ""}
      ${signatureImageHtml}
      ${settings?.signature_footer_html || ""}
    </body>
    </html>
  `;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-hidden flex flex-col" dir="rtl">
        <DialogHeader>
          <DialogTitle>توقيع العميل - {clientName}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-auto bg-white rounded-lg border">
          {isLoading ? (
            <div className="p-8 space-y-4">
              <Skeleton className="h-8 w-1/2 mx-auto" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-32 w-full mt-4" />
            </div>
          ) : (
            <div
              className="p-6"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(html, {
                  ADD_TAGS: ["style"],
                  ADD_ATTR: ["target"],
                }),
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
