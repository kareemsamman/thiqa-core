import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { normalizeArabic } from '@/lib/arabicNormalize';
import { Search, User, ArrowRight, AlertTriangle, FileText } from 'lucide-react';
import { PolicySelectionCards } from './PolicySelectionCards';

interface Client {
  id: string;
  full_name: string;
  id_number: string;
  file_number: string | null;
  phone_number: string | null;
}

interface PolicyRecord {
  id: string;
  policy_number: string | null;
  policy_type_parent: string;
  policy_type_child: string | null;
  start_date: string;
  end_date: string;
  insurance_price: number;
  cancelled: boolean | null;
  transferred: boolean | null;
  group_id: string | null;
  company: { id: string; name: string; name_ar: string | null } | null;
  car: { id: string; car_number: string } | null;
}

interface AccidentReportWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedClient?: Client | null;
}

type Step = 'client' | 'policy';

export function AccidentReportWizard({
  open,
  onOpenChange,
  preselectedClient,
}: AccidentReportWizardProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('client');
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [policies, setPolicies] = useState<PolicyRecord[]>([]);
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  // Reset state when drawer opens/closes
  useEffect(() => {
    if (open) {
      if (preselectedClient) {
        setSelectedClient(preselectedClient);
        setStep('policy');
      } else {
        setStep('client');
        setSelectedClient(null);
      }
      setSearch('');
      setClients([]);
      setPolicies([]);
    }
  }, [open, preselectedClient]);

  // Fetch policies when client is selected
  useEffect(() => {
    if (selectedClient) {
      fetchPolicies(selectedClient.id);
    }
  }, [selectedClient]);

  const searchClients = useCallback(async (query: string) => {
    if (query.length < 2) {
      setClients([]);
      return;
    }

    setSearching(true);
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('id, full_name, id_number, file_number, phone_number')
        .is('deleted_at', null)
        .or(`full_name_normalized.ilike.%${normalizeArabic(query)}%,id_number.ilike.%${query}%,phone_number.ilike.%${query}%,file_number.ilike.%${query}%`)
        .limit(20);

      if (error) throw error;
      setClients(data || []);
    } catch (error) {
      console.error('Error searching clients:', error);
      toast.error('فشل في البحث عن العملاء');
    } finally {
      setSearching(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (search.trim()) {
        searchClients(search);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search, searchClients]);

  const fetchPolicies = async (clientId: string) => {
    setLoadingPolicies(true);
    try {
      const { data, error } = await supabase
        .from('policies')
        .select(`
          id, policy_number, policy_type_parent, policy_type_child,
          start_date, end_date, insurance_price, cancelled, transferred, group_id,
          company:insurance_companies(id, name, name_ar),
          car:cars(id, car_number)
        `)
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('start_date', { ascending: false });

      if (error) throw error;
      setPolicies(data || []);
    } catch (error) {
      console.error('Error fetching policies:', error);
      toast.error('فشل في تحميل المعاملات');
    } finally {
      setLoadingPolicies(false);
    }
  };

  const handleClientSelect = (client: Client) => {
    setSelectedClient(client);
    setStep('policy');
  };

  const handlePolicySelect = (policyId: string) => {
    // Navigate to the accident report form
    navigate(`/policies/${policyId}/accident/new`);
    onOpenChange(false);
  };

  const handleBack = () => {
    if (step === 'policy' && !preselectedClient) {
      setStep('client');
      setSelectedClient(null);
      setPolicies([]);
    } else {
      onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-full sm:max-w-xl" dir="rtl">
        <SheetHeader className="mb-6">
          <div className="flex items-center gap-3">
            <Button 
              variant="ghost" 
              size="icon" 
              onClick={handleBack}
              className="shrink-0"
            >
              <ArrowRight className="h-5 w-5" />
            </Button>
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
              <SheetTitle className="text-right">
                {step === 'client' ? 'اختر العميل' : 'اختر المعاملة'}
              </SheetTitle>
            </div>
          </div>
        </SheetHeader>

        <div className="space-y-4">
          {/* Step: Client Selection */}
          {step === 'client' && (
            <>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="ابحث بالاسم، الهوية، الهاتف، أو رقم الملف..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pr-10"
                  autoFocus
                />
              </div>

              <ScrollArea className="h-[calc(100vh-220px)]">
                <div className="space-y-2 pr-4">
                  {searching ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <Card key={i} className="p-4">
                        <Skeleton className="h-12 w-full" />
                      </Card>
                    ))
                  ) : clients.length === 0 && search.length >= 2 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>لم يتم العثور على عملاء</p>
                    </div>
                  ) : search.length < 2 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Search className="h-12 w-12 mx-auto mb-4 opacity-50" />
                      <p>اكتب حرفين على الأقل للبحث</p>
                    </div>
                  ) : (
                    clients.map((client) => (
                      <Card
                        key={client.id}
                        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
                        onClick={() => handleClientSelect(client)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <p className="font-medium">{client.full_name}</p>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span>هوية: {client.id_number}</span>
                              {client.file_number && (
                                <span>ملف: #{client.file_number}</span>
                              )}
                              {client.phone_number && (
                                <span>{client.phone_number}</span>
                              )}
                            </div>
                          </div>
                          <ArrowRight className="h-5 w-5 text-muted-foreground rotate-180" />
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </ScrollArea>
            </>
          )}

          {/* Step: Policy Selection */}
          {step === 'policy' && selectedClient && (
            <>
              {/* Selected client info */}
              <Card className="p-3 bg-muted/50">
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{selectedClient.full_name}</p>
                    <p className="text-sm text-muted-foreground">
                      {selectedClient.id_number}
                      {selectedClient.file_number && ` • ملف #${selectedClient.file_number}`}
                    </p>
                  </div>
                </div>
              </Card>

              <ScrollArea className="h-[calc(100vh-280px)]">
                <div className="pr-4">
                  <PolicySelectionCards
                    policies={policies}
                    onPolicySelect={handlePolicySelect}
                    loading={loadingPolicies}
                  />
                </div>
              </ScrollArea>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
