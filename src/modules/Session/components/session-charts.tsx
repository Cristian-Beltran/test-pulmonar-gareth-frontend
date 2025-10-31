// src/pages/sessions/components/session-charts.tsx
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  LineChart,
  Line,
} from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { sessionStore } from "../data/session.store";
import type { Session, SessionData } from "../session.interface";

type Row = {
  session: string;
  date: string;
  avgPulse: number;
  avgSpo2: number;
  avgLung: number;
};

const toDate = (iso: string) =>
  new Date(iso).toLocaleDateString("es-ES", { day: "2-digit", month: "short" });

const avg = (recs: SessionData[], pick: (r: SessionData) => number) => {
  const vals = recs.map(pick).filter((n) => Number.isFinite(n));
  if (!vals.length) return 0;
  return +(vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2);
};

export function SessionCharts() {
  const { sessions } = sessionStore();

  const data: Row[] = useMemo(() => {
    return (sessions as Session[]).map((s, i) => {
      const recs = s.records ?? [];
      return {
        session: `S${i + 1}`,
        date: toDate(s.startedAt),
        avgPulse: avg(recs, (r) => Number(r.pulse)),
        avgSpo2: avg(recs, (r) => Number(r.oxygenSaturation)),
        avgLung: avg(recs, (r) => Number(r.lungCapacity)),
      };
    });
  }, [sessions]);

  if (!sessions.length) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Resumen</CardTitle>
          <CardDescription>Sin registros disponibles</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const cfg = {
    avgPulse: { label: "Pulso (BPM)" },
    avgSpo2: { label: "SpO₂ (%)" },
    avgLung: { label: "Capacidad Pulmonar" },
  } as const;

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      {/* Card 1: Pulso y SpO2 con áreas (nuevo estilo) */}
      <Card className="bg-gradient-to-b from-background to-muted/30 border-dotted">
        <CardHeader>
          <CardTitle>Tendencias Cardiorrespiratorias</CardTitle>
          <CardDescription>Promedio por sesión (Pulso y SpO₂)</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{ avgPulse: cfg.avgPulse, avgSpo2: cfg.avgSpo2 }}
            className="h-[320px] w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="gPulse" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopOpacity={0.35} />
                    <stop offset="95%" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="gSpo2" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopOpacity={0.35} />
                    <stop offset="95%" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="2 3" opacity={0.5} />
                <XAxis dataKey="session" />
                <YAxis />
                <Tooltip content={<ChartTooltipContent />} />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="avgPulse"
                  name={cfg.avgPulse.label}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gPulse)"
                />
                <Area
                  type="monotone"
                  dataKey="avgSpo2"
                  name={cfg.avgSpo2.label}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#gSpo2)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>

      {/* Card 2: Capacidad pulmonar (línea gruesa con puntos) */}
      <Card className="bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle>Capacidad Pulmonar</CardTitle>
          <CardDescription>Promedio por sesión</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer
            config={{ avgLung: cfg.avgLung }}
            className="h-[320px] w-full"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="4 4" opacity={0.4} />
                <XAxis dataKey="date" />
                <YAxis />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="avgLung"
                  name={cfg.avgLung.label}
                  strokeWidth={3}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </ChartContainer>
        </CardContent>
      </Card>
    </div>
  );
}
