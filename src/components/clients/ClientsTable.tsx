import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Search,
  Filter,
  Download,
  ChevronLeft,
  ChevronRight,
  Eye,
  MoreHorizontal,
  Phone,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Mock data for demonstration
const mockClients = [
  {
    id: "1",
    fullName: "أحمد محمد",
    idNumber: "123456789",
    fileNumber: "F001",
    phone: "050-1234567",
    totalPolicies: 3,
    totalDue: 5200,
    totalPaid: 4800,
    status: "active",
    dateJoined: "2023-01-15",
  },
  {
    id: "2",
    fullName: "سارة أبو حسين",
    idNumber: "987654321",
    fileNumber: "F002",
    phone: "052-9876543",
    totalPolicies: 2,
    totalDue: 3500,
    totalPaid: 3500,
    status: "paid",
    dateJoined: "2023-03-20",
  },
  {
    id: "3",
    fullName: "محمد خالد",
    idNumber: "456789123",
    fileNumber: "F003",
    phone: "054-4567891",
    totalPolicies: 5,
    totalDue: 8900,
    totalPaid: 6200,
    status: "partial",
    dateJoined: "2022-11-10",
  },
  {
    id: "4",
    fullName: "ليلى عمر",
    idNumber: "789123456",
    fileNumber: "F004",
    phone: "053-7891234",
    totalPolicies: 1,
    totalDue: 2100,
    totalPaid: 0,
    status: "unpaid",
    dateJoined: "2024-01-05",
  },
  {
    id: "5",
    fullName: "خالد يوسف",
    idNumber: "321654987",
    fileNumber: "F005",
    phone: "058-3216549",
    totalPolicies: 4,
    totalDue: 7600,
    totalPaid: 7600,
    status: "paid",
    dateJoined: "2023-06-18",
  },
  {
    id: "6",
    fullName: "نور الدين",
    idNumber: "654987321",
    fileNumber: "F006",
    phone: "050-6549873",
    totalPolicies: 2,
    totalDue: 4300,
    totalPaid: 2150,
    status: "partial",
    dateJoined: "2023-09-22",
  },
];

const statusConfig = {
  paid: { label: "مدفوع", variant: "success" as const },
  partial: { label: "جزئي", variant: "warning" as const },
  unpaid: { label: "غير مدفوع", variant: "destructive" as const },
  active: { label: "نشط", variant: "default" as const },
};

export function ClientsTable() {
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 10;

  const filteredClients = mockClients.filter(
    (client) =>
      client.fullName.includes(searchQuery) ||
      client.idNumber.includes(searchQuery) ||
      client.fileNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.phone.includes(searchQuery)
  );

  const totalPages = Math.ceil(filteredClients.length / pageSize);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-GB');
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="بحث بالاسم، رقم الهوية، رقم الملف، الهاتف..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pr-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm">
            <Filter className="ml-2 h-4 w-4" />
            فلترة
          </Button>
          <Button variant="outline" size="sm">
            <Download className="ml-2 h-4 w-4" />
            تصدير
          </Button>
        </div>
      </div>

      {/* Table */}
      <Card className="border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-muted-foreground font-medium">العميل</TableHead>
                <TableHead className="text-muted-foreground font-medium">رقم الهوية</TableHead>
                <TableHead className="text-muted-foreground font-medium">رقم الملف</TableHead>
                <TableHead className="text-muted-foreground font-medium">الهاتف</TableHead>
                <TableHead className="text-muted-foreground font-medium text-center">الوثائق</TableHead>
                <TableHead className="text-muted-foreground font-medium">المستحق</TableHead>
                <TableHead className="text-muted-foreground font-medium">المدفوع</TableHead>
                <TableHead className="text-muted-foreground font-medium">الحالة</TableHead>
                <TableHead className="text-muted-foreground font-medium w-[100px]">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredClients.map((client, index) => (
                <TableRow
                  key={client.id}
                  className={cn(
                    "border-border/30 transition-colors cursor-pointer",
                    "hover:bg-secondary/50 animate-fade-in"
                  )}
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                        <span className="text-sm font-medium text-primary">
                          {client.fullName.charAt(0)}
                        </span>
                      </div>
                      <div>
                        <p className="font-medium text-foreground">{client.fullName}</p>
                        <p className="text-xs text-muted-foreground">
                          انضم {formatDate(client.dateJoined)}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">
                    <bdi>{client.idNumber}</bdi>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">
                      {client.fileNumber}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground whitespace-nowrap">
                      <Phone className="h-3 w-3 shrink-0" />
                      <bdi>{client.phone}</bdi>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <FileText className="h-3 w-3 text-muted-foreground" />
                      <span className="font-medium">{client.totalPolicies}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">
                    ₪{client.totalDue.toLocaleString('en-US')}
                  </TableCell>
                  <TableCell className="font-medium text-success">
                    ₪{client.totalPaid.toLocaleString('en-US')}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusConfig[client.status as keyof typeof statusConfig].variant}>
                      {statusConfig[client.status as keyof typeof statusConfig].label}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between border-t border-border/30 px-4 py-3">
          <p className="text-sm text-muted-foreground">
            عرض {filteredClients.length} من {mockClients.length} عميل
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages || totalPages === 0}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              صفحة {currentPage} من {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
