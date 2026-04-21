import { useState, useEffect, useCallback, useRef } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Header } from "@/components/layout/Header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { FileUploader } from "@/components/media/FileUploader";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Folder,
  FolderPlus,
  Upload,
  FileText,
  Image as ImageIcon,
  ChevronLeft,
  Home,
  Copy,
  Pencil,
  Trash2,
  Loader2,
  MoreHorizontal,
  FolderUp,
} from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { format } from "date-fns";

const ALLOWED_UPLOAD_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'gif']);

interface TreeFile {
  type: 'file';
  parentPath: string;
  name: string;
  file: File;
}

interface TreeFolder {
  type: 'folder';
  path: string;
  parentPath: string;
  name: string;
}

type TreeEntry = TreeFile | TreeFolder;

interface FolderRow {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
}

interface FileRow {
  id: string;
  folder_id: string;
  name: string;
  file_url: string;
  file_type: string;
  mime_type: string | null;
  overlay_fields: any;
  created_at: string;
}

export default function FormTemplates() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(true);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: "نماذج" },
  ]);
  const [initialFolderLoaded, setInitialFolderLoaded] = useState(false);

  // On mount, read folder query param and build breadcrumbs
  useEffect(() => {
    if (initialFolderLoaded) return;
    const folderId = searchParams.get("folder");
    if (!folderId) {
      setInitialFolderLoaded(true);
      return;
    }

    (async () => {
      try {
        // Build breadcrumb chain by walking up parent_id
        const chain: { id: string; name: string }[] = [];
        let currentId: string | null = folderId;
        while (currentId) {
          const { data, error } = await supabase
            .from("form_template_folders")
            .select("id, name, parent_id")
            .eq("id", currentId)
            .single();
          if (error || !data) break;
          chain.unshift({ id: data.id, name: data.name });
          currentId = data.parent_id;
        }
        if (chain.length > 0) {
          setBreadcrumbs([{ id: null, name: "نماذج" }, ...chain.map(c => ({ id: c.id as string | null, name: c.name }))]);
          setCurrentFolderId(folderId);
        }
      } catch (err) {
        console.error("Failed to load folder path:", err);
      } finally {
        setInitialFolderLoaded(true);
        // Clear the query param
        setSearchParams({}, { replace: true });
      }
    })();
  }, [searchParams, initialFolderLoaded, setSearchParams]);

  // Dialogs
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: "folder" | "file" } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string; type: "folder" | "file" } | null>(null);
  const [saving, setSaving] = useState(false);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  // Page-level drag-and-drop for folders. Preserves the source tree by
  // recreating each directory as a form_template_folders row under the
  // current location before uploading the files into it.
  const [isDragOver, setIsDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const [treeUpload, setTreeUpload] = useState<{
    active: boolean;
    done: number;
    total: number;
    label: string;
  }>({ active: false, done: 0, total: 0, label: '' });

  // Fetch folders and files for current folder
  const fetchContents = useCallback(async () => {
    setLoading(true);
    try {
      const folderQuery = supabase
        .from("form_template_folders")
        .select("*")
        .order("name");

      if (currentFolderId) {
        folderQuery.eq("parent_id", currentFolderId);
      } else {
        folderQuery.is("parent_id", null);
      }

      const { data: foldersData, error: foldersErr } = await folderQuery;
      if (foldersErr) throw foldersErr;

      let filesData: FileRow[] = [];
      if (currentFolderId) {
        const { data, error } = await supabase
          .from("form_template_files")
          .select("*")
          .eq("folder_id", currentFolderId)
          .order("name");
        if (error) throw error;
        filesData = (data || []) as FileRow[];
      }

      setFolders((foldersData || []) as FolderRow[]);
      setFiles(filesData);
    } catch (err: any) {
      console.error(err);
      toast({ title: "خطأ", description: "فشل في تحميل المحتوى", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [currentFolderId, toast]);

  useEffect(() => {
    if (initialFolderLoaded) fetchContents();
  }, [fetchContents, initialFolderLoaded]);

  // Navigate into folder
  const openFolder = (folder: FolderRow) => {
    setCurrentFolderId(folder.id);
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  // Navigate via breadcrumb
  const navigateBreadcrumb = (index: number) => {
    const target = breadcrumbs[index];
    setCurrentFolderId(target.id);
    setBreadcrumbs((prev) => prev.slice(0, index + 1));
  };

  // Create folder
  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("form_template_folders").insert({
        name: folderName.trim(),
        parent_id: currentFolderId,
        created_by: profile?.id,
      });
      if (error) throw error;
      toast({ title: "تم إنشاء المجلد" });
      setNewFolderOpen(false);
      setFolderName("");
      fetchContents();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Rename
  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setSaving(true);
    try {
      const table = renameTarget.type === "folder" ? "form_template_folders" : "form_template_files";
      const { error } = await supabase.from(table).update({ name: renameName.trim() }).eq("id", renameTarget.id);
      if (error) throw error;
      toast({ title: "تم إعادة التسمية" });
      setRenameOpen(false);
      setRenameTarget(null);
      fetchContents();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const table = deleteTarget.type === "folder" ? "form_template_folders" : "form_template_files";
      const { error } = await supabase.from(table).delete().eq("id", deleteTarget.id);
      if (error) throw error;
      toast({ title: "تم الحذف" });
      setDeleteTarget(null);
      fetchContents();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    }
  };

  // Duplicate file
  const handleDuplicate = async (file: FileRow) => {
    setDuplicating(file.id);
    try {
      const { error } = await supabase.from("form_template_files").insert({
        folder_id: file.folder_id,
        name: `${file.name} (نسخة)`,
        file_url: file.file_url,
        file_type: file.file_type,
        mime_type: file.mime_type,
        overlay_fields: file.overlay_fields,
        created_by: profile?.id,
      });
      if (error) throw error;
      toast({ title: "تم نسخ الملف" });
      fetchContents();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setDuplicating(null);
    }
  };

  // Handle file upload complete
  const handleUploadComplete = async (uploadedFiles: any[]) => {
    if (!currentFolderId) {
      toast({ title: "خطأ", description: "يجب أن تكون داخل مجلد لرفع الملفات", variant: "destructive" });
      return;
    }

    try {
      const rows = uploadedFiles.map((f) => {
        const isPdf = f.mime_type === "application/pdf" || f.original_name?.toLowerCase().endsWith(".pdf");
        return {
          folder_id: currentFolderId,
          name: f.original_name || "ملف",
          file_url: f.cdn_url,
          file_type: isPdf ? "pdf" : "image",
          mime_type: f.mime_type || null,
          overlay_fields: [],
          created_by: profile?.id,
        };
      });

      const { error } = await supabase.from("form_template_files").insert(rows);
      if (error) throw error;

      toast({ title: "تم رفع الملفات بنجاح" });
      setUploadOpen(false);
      fetchContents();
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    }
  };

  const openRename = (id: string, name: string, type: "folder" | "file") => {
    setRenameTarget({ id, name, type });
    setRenameName(name);
    setRenameOpen(true);
  };

  // Recursively read a dropped directory entry into a flat list. Each
  // record carries its parentPath so we can rebuild the hierarchy when
  // creating folder rows.
  const collectTree = async (
    entry: any,
    parentPath: string,
  ): Promise<TreeEntry[]> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) =>
        entry.file(resolve, reject),
      );
      return [{ type: 'file', parentPath, name: entry.name, file }];
    }
    if (!entry.isDirectory) return [];

    const path = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const items: TreeEntry[] = [
      { type: 'folder', path, parentPath, name: entry.name },
    ];
    const reader = entry.createReader();
    while (true) {
      const batch: any[] = await new Promise((resolve, reject) =>
        reader.readEntries(resolve, reject),
      );
      if (!batch.length) break;
      for (const child of batch) {
        const nested = await collectTree(child, path);
        items.push(...nested);
      }
    }
    return items;
  };

  const uploadTree = async (entries: TreeEntry[]) => {
    // Filter files down to the extensions we accept; silently drop
    // OS junk (.DS_Store, Thumbs.db, .git/…) so the user doesn't see
    // a wall of errors.
    const folders = entries.filter(
      (e): e is TreeFolder => e.type === 'folder',
    );
    const files = entries.filter((e): e is TreeFile => {
      if (e.type !== 'file') return false;
      const ext = e.name.split('.').pop()?.toLowerCase();
      return !!ext && ALLOWED_UPLOAD_EXT.has(ext) && e.file.size <= 50 * 1024 * 1024;
    });

    if (folders.length === 0 && files.length === 0) {
      toast({
        title: 'لا توجد ملفات صالحة',
        description: 'الأنواع المدعومة: PDF والصور',
        variant: 'destructive',
      });
      return;
    }

    // Map folder path → DB id. '' is the current folder the user is in.
    const folderIdByPath = new Map<string, string | null>();
    folderIdByPath.set('', currentFolderId);

    // Create parents before children — depth-sort by path segment count.
    folders.sort(
      (a, b) => a.path.split('/').length - b.path.split('/').length,
    );

    setTreeUpload({
      active: true,
      done: 0,
      total: folders.length + files.length,
      label: 'جاري إنشاء المجلدات...',
    });

    try {
      for (const folder of folders) {
        const parentId = folderIdByPath.get(folder.parentPath);
        if (parentId === undefined) {
          throw new Error(`Parent folder not found for ${folder.path}`);
        }
        const { data, error } = await supabase
          .from('form_template_folders')
          .insert({
            name: folder.name,
            parent_id: parentId,
            created_by: profile?.id,
          })
          .select('id')
          .single();
        if (error) throw error;
        folderIdByPath.set(folder.path, data.id);
        setTreeUpload((p) => ({ ...p, done: p.done + 1 }));
      }

      if (files.length === 0) {
        toast({ title: 'تم إنشاء المجلدات' });
        return;
      }

      // A file dropped at the top level has parentPath '' — that maps
      // to currentFolderId. If currentFolderId is null and the drop
      // contains loose files at the root, those can't be uploaded (the
      // table requires folder_id), so flag it.
      const looseAtRoot = files.some(
        (f) => f.parentPath === '' && !currentFolderId,
      );
      if (looseAtRoot) {
        throw new Error('لا يمكن رفع الملفات الفردية خارج مجلد. أنشئ مجلداً أولاً أو اسحب المجلد نفسه.');
      }

      setTreeUpload((p) => ({ ...p, label: 'جاري رفع الملفات...' }));

      const fileRows: Array<{
        folder_id: string;
        name: string;
        file_url: string;
        file_type: string;
        mime_type: string | null;
        overlay_fields: never[];
        created_by: string | undefined;
      }> = [];

      for (const item of files) {
        const folderId = folderIdByPath.get(item.parentPath);
        if (!folderId) continue;

        const formData = new FormData();
        formData.append('file', item.file);
        formData.append('entity_type', 'form_template');

        const response = await supabase.functions.invoke('upload-media', {
          body: formData,
        });
        if (response.error) {
          console.error(`Failed to upload ${item.name}:`, response.error);
          setTreeUpload((p) => ({ ...p, done: p.done + 1 }));
          continue;
        }
        const result = response.data?.file;
        if (!result?.cdn_url) {
          setTreeUpload((p) => ({ ...p, done: p.done + 1 }));
          continue;
        }
        const isPdf =
          result.mime_type === 'application/pdf' ||
          item.name.toLowerCase().endsWith('.pdf');
        fileRows.push({
          folder_id: folderId,
          name: item.name,
          file_url: result.cdn_url,
          file_type: isPdf ? 'pdf' : 'image',
          mime_type: result.mime_type || null,
          overlay_fields: [],
          created_by: profile?.id,
        });
        setTreeUpload((p) => ({ ...p, done: p.done + 1 }));
      }

      if (fileRows.length > 0) {
        const { error: insertErr } = await supabase
          .from('form_template_files')
          .insert(fileRows);
        if (insertErr) throw insertErr;
      }

      toast({
        title: 'تم رفع المجلد',
        description: `${folders.length} مجلد، ${fileRows.length} ملف`,
      });
    } catch (err: any) {
      toast({
        title: 'خطأ',
        description: err.message || 'فشل رفع المجلد',
        variant: 'destructive',
      });
    } finally {
      setTreeUpload({ active: false, done: 0, total: 0, label: '' });
      fetchContents();
    }
  };

  const handlePageDragEnter = useCallback((e: React.DragEvent) => {
    // Only react to drags that carry files (from the OS), not from
    // in-page drags (row reorder, text selection, etc.).
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setIsDragOver(true);
  }, []);

  const handlePageDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
  }, []);

  const handlePageDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handlePageDrop = useCallback(
    async (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDragOver(false);

      const items = e.dataTransfer.items;
      if (!items || items.length === 0) return;

      const rootEntries: any[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = (items[i] as any).webkitGetAsEntry?.();
        if (entry) rootEntries.push(entry);
      }
      if (rootEntries.length === 0) return;

      const collected: TreeEntry[] = [];
      for (const entry of rootEntries) {
        const sub = await collectTree(entry, '');
        collected.push(...sub);
      }
      await uploadTree(collected);
    },
    // uploadTree / collectTree are stable-enough closures for the
    // current render; wiring them through useCallback would churn the
    // whole block on every state change without behavioral benefit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentFolderId, profile?.id],
  );

  return (
    <MainLayout>
      <Header
        title="ملفات"
        subtitle="قوالب النماذج والملفات"
      />

      <div
        className="p-4 md:p-6 space-y-4 relative"
        dir="rtl"
        onDragEnter={handlePageDragEnter}
        onDragOver={handlePageDragOver}
        onDragLeave={handlePageDragLeave}
        onDrop={handlePageDrop}
      >
        {/* Drop overlay — shown while the user drags a folder over the
            page. Covers the whole content area so the drop target is
            impossible to miss. */}
        {isDragOver && !treeUpload.active && (
          <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
            <div className="rounded-2xl border-2 border-dashed border-primary bg-background/95 px-10 py-8 text-center shadow-lg">
              <FolderUp className="mx-auto h-12 w-12 text-primary mb-3" />
              <p className="text-lg font-semibold">اسحب وأفلت المجلد هنا</p>
              <p className="text-sm text-muted-foreground mt-1">
                سيتم الحفاظ على بنية المجلدات الفرعية
              </p>
            </div>
          </div>
        )}

        {/* Progress bar for the tree upload — stays on screen until
            every folder and file has been processed so the user isn't
            left guessing. */}
        {treeUpload.active && (
          <div className="fixed bottom-6 left-6 z-50 w-80 rounded-lg border bg-card p-4 shadow-lg">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm font-medium">{treeUpload.label}</p>
            </div>
            <Progress
              value={
                treeUpload.total > 0
                  ? (treeUpload.done / treeUpload.total) * 100
                  : 0
              }
              className="h-2"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              {treeUpload.done} / {treeUpload.total}
            </p>
          </div>
        )}
        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 flex-wrap">
          {breadcrumbs.map((bc, idx) => (
            <div key={idx} className="flex items-center gap-1">
              {idx > 0 && <ChevronLeft className="h-4 w-4 text-muted-foreground" />}
              <button
                onClick={() => navigateBreadcrumb(idx)}
                className={`text-sm font-medium transition-colors ${
                  idx === breadcrumbs.length - 1
                    ? "text-foreground"
                    : "text-primary hover:underline"
                }`}
              >
                {idx === 0 ? (
                  <span className="flex items-center gap-1">
                    <Home className="h-4 w-4" />
                    {bc.name}
                  </span>
                ) : (
                  bc.name
                )}
              </button>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setNewFolderOpen(true)} className="gap-2">
            <FolderPlus className="h-4 w-4" />
            مجلد جديد
          </Button>
          {currentFolderId && (
            <Button size="sm" variant="outline" onClick={() => setUploadOpen(true)} className="gap-2">
              <Upload className="h-4 w-4" />
              رفع ملف
            </Button>
          )}
          <span className="text-xs text-muted-foreground flex items-center gap-1.5 mr-auto">
            <FolderUp className="h-3.5 w-3.5" />
            اسحب مجلداً من جهازك إلى هنا للرفع مع الحفاظ على بنية المجلدات
          </span>
        </div>

        {/* Content Table */}
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4 text-muted-foreground">
            <Folder className="h-16 w-16" />
            <p className="text-lg">
              {currentFolderId ? "هذا المجلد فارغ" : "لا توجد مجلدات بعد"}
            </p>
            <p className="text-sm">
              {currentFolderId
                ? "أضف مجلدات فرعية أو ارفع ملفات"
                : "أنشئ مجلداً جديداً للبدء"}
            </p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right w-12"></TableHead>
                  <TableHead className="text-right">الاسم</TableHead>
                  <TableHead className="text-right w-24">النوع</TableHead>
                  <TableHead className="text-right w-36">التاريخ</TableHead>
                  <TableHead className="text-right w-20">إجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Folders */}
                {folders.map((folder) => (
                  <TableRow
                    key={`folder-${folder.id}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onDoubleClick={() => openFolder(folder)}
                  >
                    <TableCell>
                      <Folder className="h-5 w-5 text-amber-500" />
                    </TableCell>
                    <TableCell
                      className="font-medium"
                      onClick={() => openFolder(folder)}
                    >
                      {folder.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">مجلد</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(folder.created_at), "yyyy-MM-dd")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openRename(folder.id, folder.name, "folder")}>
                            <Pencil className="h-4 w-4 ml-2" />
                            إعادة تسمية
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget({ id: folder.id, name: folder.name, type: "folder" })}
                          >
                            <Trash2 className="h-4 w-4 ml-2" />
                            حذف
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}

                {/* Files */}
                {files.map((file) => (
                  <TableRow
                    key={`file-${file.id}`}
                    className="cursor-pointer hover:bg-muted/50"
                    onDoubleClick={() => navigate(`/form-templates/edit/${file.id}`)}
                  >
                    <TableCell>
                      {file.file_type === "pdf" ? (
                        <FileText className="h-5 w-5 text-red-500" />
                      ) : (
                        <ImageIcon className="h-5 w-5 text-blue-500" />
                      )}
                    </TableCell>
                    <TableCell
                      className="font-medium"
                      onClick={() => navigate(`/form-templates/edit/${file.id}`)}
                    >
                      {file.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {file.file_type === "pdf" ? "PDF" : "صورة"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {format(new Date(file.created_at), "yyyy-MM-dd")}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => navigate(`/form-templates/edit/${file.id}`)}>
                            <Pencil className="h-4 w-4 ml-2" />
                            تحرير
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => handleDuplicate(file)}>
                            <Copy className="h-4 w-4 ml-2" />
                            نسخ
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => openRename(file.id, file.name, "file")}>
                            <Pencil className="h-4 w-4 ml-2" />
                            إعادة تسمية
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget({ id: file.id, name: file.name, type: "file" })}
                          >
                            <Trash2 className="h-4 w-4 ml-2" />
                            حذف
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* New Folder Dialog */}
        <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>مجلد جديد</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder="اسم المجلد..."
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewFolderOpen(false)}>إلغاء</Button>
              <Button onClick={handleCreateFolder} disabled={saving || !folderName.trim()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                إنشاء
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Upload Dialog */}
        <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
          <DialogContent dir="rtl" className="max-w-lg">
            <DialogHeader>
              <DialogTitle>رفع ملفات</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <FileUploader
                entityType="form_template"
                accept="application/pdf,image/*"
                onUploadComplete={handleUploadComplete}
              />
            </div>
          </DialogContent>
        </Dialog>

        {/* Rename Dialog */}
        <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
          <DialogContent dir="rtl">
            <DialogHeader>
              <DialogTitle>إعادة تسمية</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Input
                value={renameName}
                onChange={(e) => setRenameName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRename()}
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setRenameOpen(false)}>إلغاء</Button>
              <Button onClick={handleRename} disabled={saving || !renameName.trim()}>
                {saving && <Loader2 className="h-4 w-4 animate-spin ml-2" />}
                حفظ
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirm */}
        <DeleteConfirmDialog
          open={!!deleteTarget}
          onOpenChange={(open) => !open && setDeleteTarget(null)}
          onConfirm={handleDelete}
          title={`حذف ${deleteTarget?.type === "folder" ? "المجلد" : "الملف"}`}
          description={`هل أنت متأكد من حذف "${deleteTarget?.name}"؟ ${
            deleteTarget?.type === "folder" ? "سيتم حذف جميع محتويات المجلد." : ""
          }`}
        />
      </div>
    </MainLayout>
  );
}
