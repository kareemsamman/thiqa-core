// Asprise Scanner.js Type Declarations
// https://asprise.com/document-scan-upload-image-browser/

interface ScanOutput {
  type: string;
  format: string;
  jpeg_quality?: number;
}

interface TwainCapSetting {
  ICAP_PIXELTYPE?: string;
  ICAP_XRESOLUTION?: string;
  ICAP_YRESOLUTION?: string;
  ICAP_SUPPORTEDSIZES?: string;
  CAP_FEEDERENABLED?: boolean;
  CAP_DUPLEXENABLED?: boolean;
}

interface ScanRequest {
  use_asprise_dialog?: boolean;
  show_scanner_ui?: boolean;

  // Device selection (docs: `source_name` = 'select' | 'default' | exact source name)
  source_name?: string;
  // Keep legacy name for compatibility with some examples
  scanner_name?: string;

  prompt_scan_more?: boolean;
  twain_cap_setting?: TwainCapSetting;
  output_settings?: ScanOutput[];
}

interface ScannedImage {
  src: string;
  imageFormat?: string;
  imageSize?: number;
}

interface ScannerJS {
  scan: (
    callback: (successful: boolean, mesg: string, response: string) => void,
    request: ScanRequest
  ) => void;
  getScannedImages: (
    response: string,
    includeBase64: boolean,
    includeThumbnails: boolean
  ) => ScannedImage[];
  getScannerList: () => string[];
  isReady: () => boolean;
}

declare global {
  interface Window {
    scanner: ScannerJS;
  }
}

export {};
