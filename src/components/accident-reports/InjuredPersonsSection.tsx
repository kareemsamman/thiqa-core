 import { useState, useEffect } from "react";
 import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
 import { Button } from "@/components/ui/button";
 import { Input } from "@/components/ui/input";
 import { Label } from "@/components/ui/label";
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
 import { Plus, Trash2, Loader2, UserPlus } from "lucide-react";
 
 interface InjuredPerson {
   id: string;
   injured_name: string;
   injured_age: number | null;
   injured_address: string | null;
   injured_occupation: string | null;
   injured_salary: string | null;
   injury_type: string | null;
   sort_order: number;
   isNew?: boolean;
 }
 
 interface InjuredPersonsSectionProps {
   reportId: string | null;
 }
 
 export function InjuredPersonsSection({ reportId }: InjuredPersonsSectionProps) {
   const { toast } = useToast();
   const [loading, setLoading] = useState(false);
   const [saving, setSaving] = useState(false);
   const [persons, setPersons] = useState<InjuredPerson[]>([]);
 
   useEffect(() => {
     if (reportId) {
       fetchPersons();
     }
   }, [reportId]);
 
   const fetchPersons = async () => {
     if (!reportId) return;
     setLoading(true);
     try {
       const { data, error } = await supabase
         .from("accident_injured_persons")
         .select("*")
         .eq("accident_report_id", reportId)
         .order("sort_order");
 
       if (error) throw error;
       setPersons(data || []);
     } catch (error) {
       console.error("Error fetching injured persons:", error);
     } finally {
       setLoading(false);
     }
   };
 
   const addPerson = () => {
     setPersons([
       ...persons,
       {
         id: crypto.randomUUID(),
         injured_name: "",
         injured_age: null,
         injured_address: null,
         injured_occupation: null,
         injured_salary: null,
         injury_type: null,
         sort_order: persons.length,
         isNew: true,
       },
     ]);
   };
 
   const removePerson = async (id: string, isNew?: boolean) => {
     if (!isNew && reportId) {
       try {
         await supabase
           .from("accident_injured_persons")
           .delete()
           .eq("id", id);
       } catch (error) {
         console.error("Error deleting person:", error);
       }
     }
     setPersons(persons.filter((p) => p.id !== id));
   };
 
   const updatePerson = (id: string, updates: Partial<InjuredPerson>) => {
     setPersons(
       persons.map((p) => (p.id === id ? { ...p, ...updates } : p))
     );
   };
 
   const savePersons = async () => {
     if (!reportId) {
       toast({
         title: "تنبيه",
         description: "يجب حفظ البلاغ أولاً",
         variant: "destructive",
       });
       return;
     }
 
     setSaving(true);
     try {
       for (let i = 0; i < persons.length; i++) {
         const person = persons[i];
         const data = {
           accident_report_id: reportId,
           injured_name: person.injured_name,
           injured_age: person.injured_age,
           injured_address: person.injured_address,
           injured_occupation: person.injured_occupation,
           injured_salary: person.injured_salary,
           injury_type: person.injury_type,
           sort_order: i,
         };
 
         if (person.isNew) {
           const { data: newData } = await supabase
             .from("accident_injured_persons")
             .insert(data)
             .select("id")
             .single();
           if (newData) {
             person.id = newData.id;
             person.isNew = false;
           }
         } else {
           await supabase
             .from("accident_injured_persons")
             .update(data)
             .eq("id", person.id);
         }
       }
 
       toast({ title: "تم الحفظ", description: "تم حفظ بيانات المصابين" });
     } catch (error: any) {
       console.error("Error saving persons:", error);
       toast({
         title: "خطأ",
         description: "فشل في حفظ البيانات",
         variant: "destructive",
       });
     } finally {
       setSaving(false);
     }
   };
 
   if (loading) {
     return (
       <Card>
         <CardContent className="p-8 text-center">
           <Loader2 className="h-8 w-8 animate-spin mx-auto" />
         </CardContent>
       </Card>
     );
   }
 
   return (
     <Card>
       <CardHeader>
         <div className="flex items-center justify-between">
           <CardTitle className="text-lg">بيانات المصابين في الحادث</CardTitle>
           <Button onClick={addPerson} size="sm" variant="outline">
             <Plus className="h-4 w-4 ml-2" />
             إضافة مصاب
           </Button>
         </div>
       </CardHeader>
       <CardContent>
         {persons.length === 0 ? (
           <div className="text-center py-8 text-muted-foreground">
             <UserPlus className="h-12 w-12 mx-auto mb-4 opacity-50" />
             <p>لم يتم إضافة مصابين</p>
             <Button onClick={addPerson} variant="outline" className="mt-4">
               <Plus className="h-4 w-4 ml-2" />
               إضافة مصاب
             </Button>
           </div>
         ) : (
           <>
             <div className="overflow-x-auto">
               <Table>
                 <TableHeader>
                   <TableRow>
                     <TableHead className="w-[50px]">#</TableHead>
                     <TableHead>اسم المصاب</TableHead>
                     <TableHead className="w-[80px]">العمر</TableHead>
                     <TableHead>العنوان</TableHead>
                     <TableHead>طبيعة العمل</TableHead>
                     <TableHead className="w-[100px]">الراتب</TableHead>
                     <TableHead>نوع الإصابة</TableHead>
                     <TableHead className="w-[60px]"></TableHead>
                   </TableRow>
                 </TableHeader>
                 <TableBody>
                   {persons.map((person, index) => (
                     <TableRow key={person.id}>
                       <TableCell>{index + 1}</TableCell>
                       <TableCell>
                         <Input
                           value={person.injured_name}
                           onChange={(e) =>
                             updatePerson(person.id, { injured_name: e.target.value })
                           }
                           placeholder="الاسم"
                           className="min-w-[150px]"
                         />
                       </TableCell>
                       <TableCell>
                         <Input
                           type="number"
                           value={person.injured_age || ""}
                           onChange={(e) =>
                             updatePerson(person.id, {
                               injured_age: e.target.value ? parseInt(e.target.value) : null,
                             })
                           }
                           placeholder="العمر"
                           className="w-[70px]"
                         />
                       </TableCell>
                       <TableCell>
                         <Input
                           value={person.injured_address || ""}
                           onChange={(e) =>
                             updatePerson(person.id, { injured_address: e.target.value })
                           }
                           placeholder="العنوان"
                           className="min-w-[120px]"
                         />
                       </TableCell>
                       <TableCell>
                         <Input
                           value={person.injured_occupation || ""}
                           onChange={(e) =>
                             updatePerson(person.id, { injured_occupation: e.target.value })
                           }
                           placeholder="المهنة"
                           className="min-w-[100px]"
                         />
                       </TableCell>
                       <TableCell>
                         <Input
                           value={person.injured_salary || ""}
                           onChange={(e) =>
                             updatePerson(person.id, { injured_salary: e.target.value })
                           }
                           placeholder="₪"
                           className="w-[90px]"
                         />
                       </TableCell>
                       <TableCell>
                         <Input
                           value={person.injury_type || ""}
                           onChange={(e) =>
                             updatePerson(person.id, { injury_type: e.target.value })
                           }
                           placeholder="نوع الإصابة"
                           className="min-w-[120px]"
                         />
                       </TableCell>
                       <TableCell>
                         <Button
                           variant="ghost"
                           size="icon"
                           onClick={() => removePerson(person.id, person.isNew)}
                           className="text-destructive hover:text-destructive"
                         >
                           <Trash2 className="h-4 w-4" />
                         </Button>
                       </TableCell>
                     </TableRow>
                   ))}
                 </TableBody>
               </Table>
             </div>
 
             <div className="mt-4 flex justify-end">
               <Button onClick={savePersons} disabled={saving}>
                 {saving ? (
                   <Loader2 className="h-4 w-4 animate-spin ml-2" />
                 ) : null}
                 حفظ بيانات المصابين
               </Button>
             </div>
           </>
         )}
       </CardContent>
     </Card>
   );
 }