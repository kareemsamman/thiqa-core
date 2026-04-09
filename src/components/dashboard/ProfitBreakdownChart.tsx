import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface ProfitBreakdownChartProps {
  elzamiCommission: number;
  otherProfit: number;
  loading?: boolean;
}

const COLORS = ["hsl(var(--primary))", "hsl(var(--success))"];

export function ProfitBreakdownChart({ elzamiCommission, otherProfit, loading }: ProfitBreakdownChartProps) {
  const data = [
    { name: "عمولة إلزامي", value: elzamiCommission },
    { name: "أرباح أخرى", value: otherProfit },
  ].filter(d => d.value !== 0);

  const total = elzamiCommission + otherProfit;

  if (loading) {
    return (
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">توزيع الأرباح (السنة)</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">جاري التحميل...</div>
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0 || total === 0) {
    return (
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium">توزيع الأرباح (السنة)</CardTitle>
        </CardHeader>
        <CardContent className="h-[200px] flex items-center justify-center">
          <p className="text-muted-foreground text-sm">لا توجد أرباح حتى الآن</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">توزيع الأرباح (السنة)</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={70}
                paddingAngle={2}
                dataKey="value"
                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                labelLine={false}
              >
                {data.map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value: number) => [`₪${value.toLocaleString('en-US')}`, '']}
                contentStyle={{ 
                  direction: 'rtl', 
                  textAlign: 'right',
                  backgroundColor: 'hsl(var(--background))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px'
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex justify-center gap-6 mt-2 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[0] }} />
            <span className="text-muted-foreground">عمولة إلزامي:</span>
            <span className="font-medium">₪{elzamiCommission.toLocaleString('en-US')}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[1] }} />
            <span className="text-muted-foreground">أرباح أخرى:</span>
            <span className="font-medium">₪{otherProfit.toLocaleString('en-US')}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}